// Roteador do edge-runtime self-hosted: /functions/v1/<nome> → pasta <nome>.
// Cópia do roteador oficial do supabase/docker, sem verificação de JWT aqui —
// cada function do EisenFlow valida a própria autenticação (JWT, service role
// ou x-internal-secret), então VERIFY_JWT fica false no container.
import * as jose from 'https://deno.land/x/jose@v4.14.4/index.ts';

const FUNCTIONS_DIR = '/home/deno/functions';
const VERIFY_JWT = (Deno.env.get('VERIFY_JWT') ?? 'false') === 'true';
const JWT_SECRET = Deno.env.get('JWT_SECRET') ?? '';

async function jwtValido(req: Request) {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  try {
    await jose.jwtVerify(token, new TextEncoder().encode(JWT_SECRET));
    return true;
  } catch { return false; }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const nome = url.pathname.split('/').filter(Boolean)[0];
  if (!nome || nome.startsWith('_')) return new Response('não encontrado', { status: 404 });
  if (VERIFY_JWT && !(await jwtValido(req))) {
    return new Response(JSON.stringify({ error: 'JWT inválido' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  try {
    // @ts-ignore: API do edge-runtime
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `${FUNCTIONS_DIR}/${nome}`,
      memoryLimitMb: 150,
      workerTimeoutMs: 5 * 60 * 1000,
      noModuleCache: false,
      envVars: Object.entries(Deno.env.toObject()),
    });
    return await worker.fetch(req);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    const status = /not found|NotFound|no such file/i.test(msg) ? 404 : 500;
    return new Response(JSON.stringify({ error: msg }), { status, headers: { 'content-type': 'application/json' } });
  }
});
