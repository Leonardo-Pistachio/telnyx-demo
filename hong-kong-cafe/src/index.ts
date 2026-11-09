export { CallSession } from "./actors/CallSession";
export { DayBookings } from "./actors/DayBookings";

import { app } from "./app";

export default {
  fetch(request: Request, env: Env) {
    return app.fetch(request, env);
  },
};
