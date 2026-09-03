/**
 * Storage — equivalente ao `supabase.storage`.
 *
 * Supabase                                   Appwrite
 * ------------------------------------------ ------------------------------------
 * storage.from(b).upload(path, file)         uploadFile(b, file, permissions)
 * storage.from(b).createSignedUrl(path, s)   fileViewUrl(b, fileId)  (autenticada)
 * storage.from(b).getPublicUrl(path)         fileViewUrl(b, fileId)
 * storage.from(b).remove([path])             deleteFile(b, fileId)
 * storage.from(b).download(path)             downloadFile(b, fileId)
 *
 * Diferença central: no Supabase o identificador era um CAMINHO (`{task_id}/foto.png`)
 * e a permissão vinha de policies sobre esse caminho. No Appwrite o identificador
 * é um fileId e a permissão fica NO ARQUIVO. Por isso `uploadFile` recebe as
 * permissões e a collection `task_attachments` guarda `bucket_id` + `file_id`.
 */
import { storage, ID, Permission, Role } from './client';
import { BUCKETS } from './types';

export type BucketId = (typeof BUCKETS)[keyof typeof BUCKETS];

export async function uploadFile(bucketId: BucketId, file: File, permissions?: string[]) {
  return storage.createFile(bucketId, ID.unique(), file, permissions);
}

export const deleteFile = (bucketId: BucketId, fileId: string) =>
  storage.deleteFile(bucketId, fileId);

export const getFile = (bucketId: BucketId, fileId: string) =>
  storage.getFile(bucketId, fileId);

/** URL para exibir (<img src>). Respeita a sessão do usuário. */
export const fileViewUrl = (bucketId: BucketId, fileId: string) =>
  storage.getFileView(bucketId, fileId).toString();

/** URL para baixar com o nome original. */
export const fileDownloadUrl = (bucketId: BucketId, fileId: string) =>
  storage.getFileDownload(bucketId, fileId).toString();

/** Miniatura — só funciona em imagem. */
export const filePreviewUrl = (bucketId: BucketId, fileId: string, width = 400, height = 400) =>
  storage.getFilePreview(bucketId, fileId, width, height).toString();

/** Quem enviou lê, edita e apaga; opcionalmente mais gente lê. */
export function fileOwnerPermissions(userId: string, alsoReadableBy: string[] = []) {
  return [
    Permission.read(Role.user(userId)),
    Permission.update(Role.user(userId)),
    Permission.delete(Role.user(userId)),
    ...alsoReadableBy.map((uid) => Permission.read(Role.user(uid))),
  ];
}
