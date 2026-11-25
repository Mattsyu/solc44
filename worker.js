// Point d'entrée Cloudflare Workers : /api/* va à la fonction de la popotte,
// le reste (la page) est servi depuis le dossier public.
import { onRequest } from "./functions/api/[[path]].js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) return onRequest({ request, env });
    return env.ASSETS.fetch(request);
  },
};
