/**
 * GitService — manages Git repository lifecycle for projects.
 *
 * When a project transitions from planning to building:
 *   1. A bare Git repo is created at ~/.ai-engine/projects/<project-id>/repo.git
 *   2. An initial commit is made with a README and .gitignore
 *   3. Workers clone this repo into Docker containers via SSH or file:// protocol
 *
 * Each task creates a feature branch, does its work, and merges back to main.
 * The service also handles cleanup when projects are completed or deleted.
 */

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { mkdir, rm, writeFile, readFile, access, constants } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { SshKeyService } from './ssh-key-service.js';
import type { ProjectGitInfo, GitRepoConfig } from '@ai-engine/shared';

const execFile = promisify(execFileCb);

const PROJECTS_DIR = join(homedir(), '.ai-engine', 'projects');

/**
 * Build a GIT_SSH_COMMAND env value that points to our managed SSH key.
 */
function sshCommand(privateKeyPath: string): string {
  return `ssh -i "${privateKeyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
}

export class GitService {
  private static instance: GitService;
  private sshKeyService: SshKeyService;

  private constructor() {
    this.sshKeyService = SshKeyService.getInstance();
  }

  static getInstance(): GitService {
    if (!GitService.instance) {
      GitService.instance = new GitService();
    }
    return GitService.instance;
  }

  // ---------------------------------------------------------------------------
  // Repository lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Create a new Git repository for a project.
   * Creates a bare repo that acts as the central "server" repo.
   * Also creates an initial working copy with a first commit.
   */
  async createProjectRepo(projectId: string, projectName: string, prd?: string | null): Promise<GitRepoConfig> {
    const projectDir = join(PROJECTS_DIR, projectId);
    const bareRepoPath = join(projectDir, 'repo.git');
    const workingCopyPath = join(projectDir, 'working');

    await mkdir(projectDir, { recursive: true });

    // 1. Create bare repository
    await execFile('git', ['init', '--bare', bareRepoPath]);
    console.log(`[git] Created bare repo at ${bareRepoPath}`);

    // 2. Create a temporary working copy to make the initial commit
    await execFile('git', ['clone', bareRepoPath, workingCopyPath]);

    // 3. Create initial files
    const gitignore = [
      'node_modules/',
      '.env',
      '.env.local',
      'dist/',
      'build/',
      '.next/',
      '*.log',
      '.DS_Store',
      'coverage/',
      '.turbo/',
    ].join('\n');

    await writeFile(join(workingCopyPath, '.gitignore'), gitignore + '\n');

    // Create a project info file (not markdown, respecting project rules)
    const projectInfo = [
      `Project: ${projectName}`,
      `ID: ${projectId}`,
      `Created: ${new Date().toISOString()}`,
      '',
      prd ? `--- PRD ---\n${prd}` : '',
    ].join('\n');
    await writeFile(join(workingCopyPath, 'PROJECT_INFO.txt'), projectInfo);

    // 4. Initial commit
    const gitOpts = { cwd: workingCopyPath };
    await execFile('git', ['config', 'user.email', 'ai-engine@local'], gitOpts);
    await execFile('git', ['config', 'user.name', 'AI Engine'], gitOpts);
    await execFile('git', ['add', '-A'], gitOpts);
    await execFile('git', ['commit', '-m', 'Initial project setup'], gitOpts);

    // Ensure the default branch is 'main'
    try {
      await execFile('git', ['branch', '-M', 'main'], gitOpts);
    } catch {
      // Already on main
    }

    // 5. Push to bare repo
    await execFile('git', ['push', 'origin', 'HEAD:main'], gitOpts);

    // 6. Set HEAD of bare repo to main
    await execFile('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bareRepoPath });

    // 7. Clean up working copy (agents will clone their own)
    await rm(workingCopyPath, { recursive: true, force: true });

    const fingerprint = (await this.sshKeyService.getPublicKeyInfo()).fingerprint;

    const config: GitRepoConfig = {
      localPath: bareRepoPath,
      remoteUrl: null,
      defaultBranch: 'main',
      sshKeyFingerprint: fingerprint,
    };

    console.log(`[git] Project repo initialized: ${bareRepoPath}`);
    return config;
  }

  /**
   * Clone a project repo into a working directory (for Docker containers / workers).
   */
  async cloneForWorker(bareRepoPath: string, targetDir: string): Promise<void> {
    await mkdir(targetDir, { recursive: true });
    await execFile('git', ['clone', bareRepoPath, targetDir]);

    // Configure git user for commits
    const gitOpts = { cwd: targetDir };
    await execFile('git', ['config', 'user.email', 'ai-engine@local'], gitOpts);
    await execFile('git', ['config', 'user.name', 'AI Engine'], gitOpts);
  }

  /**
   * Clone a remote repo using SSH (for workers accessing dashboard-hosted repos).
   */
  async cloneRemote(repoUrl: string, targetDir: string): Promise<void> {
    const privateKeyPath = this.sshKeyService.getPrivateKeyPath();
    const env = {
      ...process.env,
      GIT_SSH_COMMAND: sshCommand(privateKeyPath),
    };

    await mkdir(targetDir, { recursive: true });
    await execFile('git', ['clone', repoUrl, targetDir], { env });

    const gitOpts = { cwd: targetDir, env };
    await execFile('git', ['config', 'user.email', 'ai-engine@local'], gitOpts);
    await execFile('git', ['config', 'user.name', 'AI Engine'], gitOpts);
  }

  // ---------------------------------------------------------------------------
  // Branch operations (used within Docker containers / task execution)
  // ---------------------------------------------------------------------------

  /**
   * Create a feature branch for a task.
   */
  async createTaskBranch(repoDir: string, taskId: string, taskTitle: string): Promise<string> {
    const branchName = this.sanitizeBranchName(`task/${taskId.slice(0, 8)}-${taskTitle}`);
    const gitOpts = { cwd: repoDir };

    // Make sure we're on the latest main
    await execFile('git', ['checkout', 'main'], gitOpts);
    await execFile('git', ['pull', 'origin', 'main'], gitOpts).catch(() => {});
    await execFile('git', ['checkout', '-b', branchName], gitOpts);

    console.log(`[git] Created branch: ${branchName}`);
    return branchName;
  }

  /**
   * Commit all changes on the current branch.
   */
  async commitChanges(repoDir: string, message: string): Promise<{ hash: string; filesChanged: number }> {
    const gitOpts = { cwd: repoDir };

    // Stage all changes
    await execFile('git', ['add', '-A'], gitOpts);

    // Check if there are changes to commit
    const { stdout: status } = await execFile('git', ['status', '--porcelain'], gitOpts);
    if (!status.trim()) {
      return { hash: '', filesChanged: 0 };
    }

    const filesChanged = status.trim().split('\n').length;

    await execFile('git', ['commit', '-m', message], gitOpts);
    const { stdout: hashOut } = await execFile('git', ['rev-parse', 'HEAD'], gitOpts);

    return { hash: hashOut.trim(), filesChanged };
  }

  /**
   * Push a branch to origin.
   */
  async pushBranch(repoDir: string, branchName: string): Promise<void> {
    const gitOpts = { cwd: repoDir };
    await execFile('git', ['push', 'origin', branchName], gitOpts);
  }

  /**
   * Push using SSH (for remote repos).
   */
  async pushBranchRemote(repoDir: string, branchName: string): Promise<void> {
    const privateKeyPath = this.sshKeyService.getPrivateKeyPath();
    const env = {
      ...process.env,
      GIT_SSH_COMMAND: sshCommand(privateKeyPath),
    };
    await execFile('git', ['push', 'origin', branchName], { cwd: repoDir, env });
  }

  /**
   * Merge a task branch back into main.
   * Uses --no-ff to preserve the branch history.
   */
  async mergeBranch(repoDir: string, branchName: string): Promise<{ success: boolean; conflicts: boolean }> {
    const gitOpts = { cwd: repoDir };

    try {
      await execFile('git', ['checkout', 'main'], gitOpts);
      await execFile('git', ['pull', 'origin', 'main'], gitOpts).catch(() => {});
      await execFile('git', ['merge', '--no-ff', branchName, '-m', `Merge ${branchName}`], gitOpts);
      await execFile('git', ['push', 'origin', 'main'], gitOpts);

      // Delete the feature branch (local and remote)
      await execFile('git', ['branch', '-d', branchName], gitOpts).catch(() => {});
      await execFile('git', ['push', 'origin', '--delete', branchName], gitOpts).catch(() => {});

      return { success: true, conflicts: false };
    } catch (error: any) {
      // If merge conflicts, abort and report
      if (error.message?.includes('CONFLICT') || error.stderr?.includes('CONFLICT')) {
        await execFile('git', ['merge', '--abort'], gitOpts).catch(() => {});
        return { success: false, conflicts: true };
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Query operations
  // ---------------------------------------------------------------------------

  /**
   * Get info about a project's Git repository.
   */
  async getProjectRepoInfo(projectId: string): Promise<ProjectGitInfo | null> {
    const bareRepoPath = join(PROJECTS_DIR, projectId, 'repo.git');

    try {
      await access(bareRepoPath, constants.R_OK);
    } catch {
      return null;
    }

    const gitOpts = { cwd: bareRepoPath };

    // Get branches
    let branches: string[] = [];
    try {
      const { stdout } = await execFile('git', ['branch', '--list'], gitOpts);
      branches = stdout
        .split('\n')
        .map((b) => b.replace('*', '').trim())
        .filter(Boolean);
    } catch {}

    // Get last commit
    let lastCommit: string | null = null;
    try {
      const { stdout } = await execFile('git', ['log', '-1', '--format=%H %s'], gitOpts);
      lastCommit = stdout.trim() || null;
    } catch {}

    return {
      projectId,
      repoPath: bareRepoPath,
      remoteUrl: null,
      defaultBranch: 'main',
      branches,
      lastCommit,
      createdAt: new Date().toISOString(), // TODO: read from meta file
    };
  }

  /**
   * Get the bare repo path for a project.
   */
  getRepoPath(projectId: string): string {
    return join(PROJECTS_DIR, projectId, 'repo.git');
  }

  /**
   * Get the projects base directory.
   */
  getProjectsDir(): string {
    return PROJECTS_DIR;
  }

  /**
   * List branches in a repo.
   */
  async listBranches(repoDir: string): Promise<string[]> {
    try {
      const { stdout } = await execFile('git', ['branch', '-a'], { cwd: repoDir });
      return stdout
        .split('\n')
        .map((b) => b.replace('*', '').trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Delete a project's Git repository and all associated data.
   */
  async deleteProjectRepo(projectId: string): Promise<void> {
    const projectDir = join(PROJECTS_DIR, projectId);
    await rm(projectDir, { recursive: true, force: true });
    console.log(`[git] Deleted project repo: ${projectDir}`);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Sanitize a string for use as a Git branch name.
   */
  private sanitizeBranchName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\-_/]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100);
  }
}
