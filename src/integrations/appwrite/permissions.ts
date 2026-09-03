/**
 * Tradução das políticas RLS do Postgres para permissões do Appwrite.
 *
 * No Supabase a regra ficava no banco (RLS avaliada a cada query).
 * No Appwrite a regra fica NO DOCUMENTO, gravada no momento da criação.
 * Consequência prática: sempre que a "dona" de um registro muda — delegar uma
 * tarefa, compartilhar, mover de tenant — é preciso ATUALIZAR as permissões
 * do documento. As funções abaixo centralizam isso.
 */
import { Permission, Role } from './client';
import type { SharePermission } from './types';

/** Dono exclusivo: só ele lê, edita e apaga. */
export const ownerOnly = (userId: string) => [
  Permission.read(Role.user(userId)),
  Permission.update(Role.user(userId)),
  Permission.delete(Role.user(userId)),
];

/**
 * Permissões de uma tarefa. Reproduz as policies:
 *   "Users can view their own tasks"        -> criador e responsável leem
 *   "Users can update their own tasks"      -> criador e responsável editam
 *   "Users can delete their own tasks"      -> só o criador apaga
 *   "Tenant members can view tenant tasks"  -> time do tenant lê
 *   "Users can view/update shared tasks"    -> compartilhados leem (edit -> editam)
 */
export function taskPermissions(opts: {
  createdBy: string;
  assignedTo?: string | null;
  tenantTeamId?: string | null;
  shares?: Array<{ userId: string; permission: SharePermission }>;
}) {
  const { createdBy, assignedTo, tenantTeamId, shares = [] } = opts;
  const perms = [
    Permission.read(Role.user(createdBy)),
    Permission.update(Role.user(createdBy)),
    Permission.delete(Role.user(createdBy)),
  ];

  if (assignedTo && assignedTo !== createdBy) {
    perms.push(Permission.read(Role.user(assignedTo)));
    perms.push(Permission.update(Role.user(assignedTo)));
  }

  // Tenant = Team nativo do Appwrite. 'guest' não apaga (policy RESTRICTIVE original).
  if (tenantTeamId) perms.push(Permission.read(Role.team(tenantTeamId)));

  for (const s of shares) {
    perms.push(Permission.read(Role.user(s.userId)));
    if (s.permission === 'edit') perms.push(Permission.update(Role.user(s.userId)));
  }

  return [...new Set(perms)];
}

/** Projeto: dono + (opcional) leitura do tenant e do time. */
export function projectPermissions(opts: {
  ownerId: string;
  tenantTeamId?: string | null;
  teamId?: string | null;
}) {
  const perms = ownerOnly(opts.ownerId);
  if (opts.tenantTeamId) perms.push(Permission.read(Role.team(opts.tenantTeamId)));
  return [...new Set(perms)];
}

/** Documento filho herda as permissões do pai (subtasks, anexos, lembretes). */
export const inheritFrom = (parentPermissions: string[]) => [...parentPermissions];

/** Só leitura para o dono — o servidor escreve (notifications, badges, fila). */
export const serverWritesUserReads = (userId: string) => [Permission.read(Role.user(userId))];

/** Tenant inteiro lê; admins/owners escrevem. */
export function tenantPermissions(teamId: string) {
  return [
    Permission.read(Role.team(teamId)),
    Permission.update(Role.team(teamId, 'admin')),
    Permission.delete(Role.team(teamId, 'owner')),
  ];
}
