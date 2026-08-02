import 'server-only';
import { Types, type HydratedDocument } from 'mongoose';
import { connectDB } from '@/lib/db';
import { Project, canEditProject, canReadProject, type ProjectDoc } from '@/lib/models/Project';
import { HttpError } from '@/lib/session';

export type ProjectDocument = HydratedDocument<ProjectDoc>;

/**
 * Shared ownership/share access checks for project routes (Constitution III:
 * every domain route checks ownership server-side; owner or sharedWith reads,
 * owner-only mutates).
 */
export async function getProjectForRead(id: string, userId: string): Promise<ProjectDocument> {
  await connectDB();
  if (!Types.ObjectId.isValid(id)) throw new HttpError(404, 'Project not found');
  const project = await Project.findById(id);
  if (!project) throw new HttpError(404, 'Project not found');
  if (!canReadProject(project, userId)) throw new HttpError(403, 'You do not have access to this project');
  return project;
}

export async function getProjectForWrite(id: string, userId: string): Promise<ProjectDocument> {
  const project = await getProjectForRead(id, userId);
  if (!canEditProject(project, userId)) throw new HttpError(403, 'Only the project owner can modify it');
  return project;
}
