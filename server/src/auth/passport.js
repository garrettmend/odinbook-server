import passport from "passport";
import passportJwt from "passport-jwt";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

const { Strategy: JwtStrategy, ExtractJwt } = passportJwt;

export function configurePassport() {
  // Register a Passport strategy named "jwt".
  // Passport will:
  // 1) read the token from the Authorization header (Bearer token)
  // 2) verify the token signature with env.jwtSecret
  // 3) give us the decoded payload so we can load the user
  passport.use(
    new JwtStrategy(
      {
        // Where to find the token on incoming requests.
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        // Secret used to verify HS256 JWTs (must match what we sign with).
        secretOrKey: env.jwtSecret,
      },
      async (payload, done) => {
        try {
          // Our tokens store user id under the standard claim `sub`.
          const userId = payload?.sub;
          if (!userId) return done(null, false);

          // Load the user from the database.
          // We select only safe public fields (do NOT return passwordHash).
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              email: true,
              name: true,
              avatarUrl: true,
              avatarPublicId: true,
              createdAt: true,
            },
          });

          if (!user) return done(null, false);

          // `done(null, user)` tells Passport “auth succeeded” and attaches
          // the user object to `req.user`.
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      },
    ),
  );
}

// Export the configured passport instance.
export { passport };
