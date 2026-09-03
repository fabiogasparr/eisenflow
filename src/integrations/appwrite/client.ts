/**
 * Cliente Appwrite do EisenFlow.
 * Substitui src/integrations/supabase/client.ts.
 *
 * .env:
 *   VITE_APPWRITE_ENDPOINT=https://appwrite.kz3solucoes.cloud/v1
 *   VITE_APPWRITE_PROJECT_ID=...
 */
import { Client, Account, Databases, Storage, Functions, Teams, Avatars } from 'appwrite';

const endpoint = import.meta.env.VITE_APPWRITE_ENDPOINT as string;
const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID as string;

if (!endpoint || !projectId) {
  throw new Error(
    'Appwrite não configurado. Defina VITE_APPWRITE_ENDPOINT e VITE_APPWRITE_PROJECT_ID no .env',
  );
}

export const client = new Client().setEndpoint(endpoint).setProject(projectId);

export const account = new Account(client);
export const databases = new Databases(client);
export const storage = new Storage(client);
export const functions = new Functions(client);
export const teams = new Teams(client);
export const avatars = new Avatars(client);

export { ID, Query, Permission, Role } from 'appwrite';
export type { Models } from 'appwrite';
