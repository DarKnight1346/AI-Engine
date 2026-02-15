import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

// ── Helpers ──

interface WireframeElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  wireframeRefId?: string;
  props?: Record<string, unknown>;
}

/**
 * Compute composition relationships for all wireframes in a project.
 * Returns maps of wireframeId -> names of wireframes it contains / is used in.
 */
function computeComposition(wireframes: Array<{ id: string; name: string; elements: unknown }>) {
  const idToName = new Map(wireframes.map((w) => [w.id, w.name]));

  const containsMap = new Map<string, string[]>();
  const usedInMap = new Map<string, string[]>();

  for (const wf of wireframes) {
    const elements = (Array.isArray(wf.elements) ? wf.elements : []) as WireframeElement[];
    const refs = elements
      .filter((el) => el.type === 'wireframeRef' && el.wireframeRefId)
      .map((el) => el.wireframeRefId!);

    const uniqueRefs = [...new Set(refs)];
    const refNames = uniqueRefs
      .map((refId) => idToName.get(refId))
      .filter((n): n is string => !!n);

    containsMap.set(wf.id, refNames);

    for (const refId of uniqueRefs) {
      if (!usedInMap.has(refId)) usedInMap.set(refId, []);
      usedInMap.get(refId)!.push(wf.name);
    }
  }

  return { containsMap, usedInMap };
}

/**
 * GET - List all wireframes for a project with composition data.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ error: 'projectId query param is required' }, { status: 400 });
    }

    const db = getDb();
    const wireframes = await db.projectWireframe.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
    });

    const { containsMap, usedInMap } = computeComposition(wireframes);

    const result = wireframes.map((wf: any) => {
      const elements = (Array.isArray(wf.elements) ? wf.elements : []) as WireframeElement[];
      return {
        id: wf.id,
        name: wf.name,
        description: wf.description,
        wireframeType: wf.wireframeType,
        elements: wf.elements,
        featureTags: wf.featureTags,
        canvasWidth: wf.canvasWidth,
        canvasHeight: wf.canvasHeight,
        sortOrder: wf.sortOrder,
        elementCount: elements.length,
        contains: containsMap.get(wf.id) || [],
        usedIn: usedInMap.get(wf.id) || [],
        createdAt: wf.createdAt,
        updatedAt: wf.updatedAt,
      };
    });

    return NextResponse.json({ wireframes: result });
  } catch (err: any) {
    console.error('GET wireframes error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST - Create a new wireframe.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, name, description, wireframeType, elements, featureTags, canvasWidth, canvasHeight } = body;

    if (!projectId || !name) {
      return NextResponse.json({ error: 'projectId and name are required' }, { status: 400 });
    }

    const db = getDb();

    // Validate project exists
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Check name uniqueness within project
    const existing = await db.projectWireframe.findFirst({
      where: { projectId, name },
    });
    if (existing) {
      return NextResponse.json(
        { error: `A wireframe named "${name}" already exists in this project.` },
        { status: 409 },
      );
    }

    // Get next sort order
    const maxSort = await db.projectWireframe.findFirst({
      where: { projectId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const nextSort = (maxSort?.sortOrder ?? -1) + 1;

    const wireframe = await db.projectWireframe.create({
      data: {
        projectId,
        name,
        description: description || null,
        wireframeType: wireframeType || 'component',
        elements: elements || [],
        featureTags: featureTags || [],
        canvasWidth: canvasWidth || 800,
        canvasHeight: canvasHeight || 600,
        sortOrder: nextSort,
      },
    });

    return NextResponse.json({ wireframe });
  } catch (err: any) {
    console.error('POST wireframe error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PUT - Update an existing wireframe.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...fields } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const db = getDb();

    const existing = await db.projectWireframe.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Wireframe not found' }, { status: 404 });
    }

    // If renaming, check uniqueness
    if (fields.name && fields.name !== existing.name) {
      const nameConflict = await db.projectWireframe.findFirst({
        where: { projectId: existing.projectId, name: fields.name },
      });
      if (nameConflict) {
        return NextResponse.json(
          { error: `A wireframe named "${fields.name}" already exists.` },
          { status: 409 },
        );
      }
    }

    // If elements contain wireframeRefs, validate they still exist
    if (fields.elements && Array.isArray(fields.elements)) {
      const refIds = (fields.elements as WireframeElement[])
        .filter((el) => el.type === 'wireframeRef' && el.wireframeRefId)
        .map((el) => el.wireframeRefId!);

      if (refIds.length > 0) {
        const found = await db.projectWireframe.findMany({
          where: { id: { in: refIds } },
          select: { id: true },
        });
        const foundIds = new Set(found.map((f: any) => f.id));
        const missing = refIds.filter((r) => !foundIds.has(r));
        if (missing.length > 0) {
          // Remove stale references rather than failing
          fields.elements = (fields.elements as WireframeElement[]).filter(
            (el) => el.type !== 'wireframeRef' || !el.wireframeRefId || foundIds.has(el.wireframeRefId),
          );
        }
      }
    }

    const updateData: Record<string, unknown> = {};
    if (fields.name !== undefined) updateData.name = fields.name;
    if (fields.description !== undefined) updateData.description = fields.description;
    if (fields.wireframeType !== undefined) updateData.wireframeType = fields.wireframeType;
    if (fields.elements !== undefined) updateData.elements = fields.elements;
    if (fields.featureTags !== undefined) updateData.featureTags = fields.featureTags;
    if (fields.canvasWidth !== undefined) updateData.canvasWidth = fields.canvasWidth;
    if (fields.canvasHeight !== undefined) updateData.canvasHeight = fields.canvasHeight;
    if (fields.sortOrder !== undefined) updateData.sortOrder = fields.sortOrder;

    const wireframe = await db.projectWireframe.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ wireframe });
  } catch (err: any) {
    console.error('PUT wireframe error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE - Delete a wireframe. Warns if other wireframes reference it.
 * Pass ?force=true to delete and clean up references in parent wireframes.
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const force = searchParams.get('force') === 'true';

    if (!id) {
      return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
    }

    const db = getDb();

    const wireframe = await db.projectWireframe.findUnique({ where: { id } });
    if (!wireframe) {
      return NextResponse.json({ error: 'Wireframe not found' }, { status: 404 });
    }

    // Check if other wireframes reference this one
    const allWireframes = await db.projectWireframe.findMany({
      where: { projectId: wireframe.projectId },
    });

    const referencingWireframes = allWireframes.filter((wf: any) => {
      if (wf.id === id) return false;
      const elements = (Array.isArray(wf.elements) ? wf.elements : []) as WireframeElement[];
      return elements.some((el) => el.type === 'wireframeRef' && el.wireframeRefId === id);
    });

    if (referencingWireframes.length > 0 && !force) {
      return NextResponse.json({
        warning: true,
        message: `This wireframe is used in ${referencingWireframes.length} other wireframe(s). Deleting it will remove those references.`,
        referencedBy: referencingWireframes.map((wf: any) => ({ id: wf.id, name: wf.name })),
      });
    }

    // If force or no references, clean up refs in parent wireframes and delete
    if (referencingWireframes.length > 0) {
      for (const parent of referencingWireframes) {
        const elements = (Array.isArray(parent.elements) ? parent.elements : []) as WireframeElement[];
        const cleaned = elements.filter(
          (el) => !(el.type === 'wireframeRef' && el.wireframeRefId === id),
        );
        await db.projectWireframe.update({
          where: { id: parent.id },
          data: { elements: cleaned },
        });
      }
    }

    await db.projectWireframe.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('DELETE wireframe error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
