import { createD1App } from "./d1-app.mjs";

export default {
  async fetch(request, env) {
    return createD1App(env).handle(request);
  }
};

