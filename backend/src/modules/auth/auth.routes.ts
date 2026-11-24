
import { Router, Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/database";

const router = Router();

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);

router.post("/google", async (req: Request, res: Response) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      res.status(400).json({ message: "Google credential is required" });
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const jwtSecret = process.env.JWT_SECRET;

    if (!clientId || !jwtSecret) {
      res.status(500).json({ message: "Authentication is not configured" });
      return;
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });

    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email || !payload.email_verified) {
      res.status(401).json({ message: "Invalid Google account" });
      return;
    }

    const user = await prisma.user.upsert({
      where: { googleId: payload.sub },
      update: {
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
      },
      create: {
        googleId: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
      },
      select: {
        id: true,
        email: true,
        name: true,
        picture: true,
      },
    });

    const token = jwt.sign(
      { userId: user.id },
      jwtSecret,
      { expiresIn: "1d" }
    );

    res.json({ message: "Login successful", token, user });
  } catch (error) {
    console.error("Google authentication error:", error);
    res.status(401).json({ message: "Google authentication failed" });
  }
});

export default router;
