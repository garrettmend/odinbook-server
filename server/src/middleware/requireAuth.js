import { passport } from "../auth/passport.js";

// Express middleware that protects a route.
// If the JWT is valid, Passport sets req.user and the request continues.
// If invalid/missing, Passport ends the request with 401 Unauthorized.
export const requireAuth = passport.authenticate("jwt", {
  session: false,
});
