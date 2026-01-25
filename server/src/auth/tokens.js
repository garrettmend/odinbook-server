import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

// Creates a JWT “access token”.
// - The client stores this token (usually in localStorage)
// - The client sends it back on protected requests as:
//   Authorization: Bearer <token>
// - The server verifies it with Passport/JWT.
export function signAccessToken({ userId }) {
  // JWT payload: we store the user id in the standard claim `sub` (“subject”).
  // Secret: env.jwtSecret is the key used to sign the token.
  // expiresIn: adds an expiration time (so tokens eventually become invalid).
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}
