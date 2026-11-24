
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { redis } from "../../config/redis";
import { prisma } from "../../config/database";
import { requireAuth, AuthRequest } from "../../middleware/auth.middleware";
import { encryptToken } from "../../services/slack-encryption.service";

const router = Router();

const redirectUri = process.env.SLACK_REDIRECT_URI;

router.get("/connect", requireAuth, async (req: Request, res: Response) => {
  try {
    const clientId = process.env.SLACK_CLIENT_ID;

    if (!clientId || !redirectUri) {
      res.status(500).json({ message: "Slack OAuth is not configured" });
      return;
    }

    const userId = (req as AuthRequest).user!.id;
    const state = crypto.randomBytes(32).toString("hex");

    await redis.set(`slack:oauth:${state}`, userId, "EX", 600);

    const params = new URLSearchParams({
      client_id: clientId,
      scope: "chat:write",
      redirect_uri: redirectUri,
      state,
    });

res.json({
  url: `https://slack.com/oauth/v2/authorize?${params.toString()}`,
});
  } catch (error) {
    console.error("Slack connect error:", error);
    res.status(500).json({ message: "Could not start Slack connection" });
  }
});

router.get("/callback", async (req: Request, res: Response) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      res.status(400).send("Slack authorization was cancelled.");
      return;
    }

    if (typeof code !== "string" || typeof state !== "string") {
      res.status(400).send("Invalid Slack OAuth callback.");
      return;
    }

    const stateKey = `slack:oauth:${state}`;
    const userId = await redis.get(stateKey);

    if (!userId) {
      res.status(400).send("Invalid or expired Slack authorization state.");
      return;
    }

    await redis.del(stateKey);

    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;

    if (!clientId || !clientSecret || !redirectUri) {
      res.status(500).send("Slack OAuth is not configured.");
      return;
    }

    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    const data = await response.json() as {
      ok: boolean;
      error?: string;
      access_token?: string;
      team?: { id?: string; name?: string };
      bot_user_id?: string;
    };

    if (!data.ok || !data.access_token || !data.team?.id) {
      console.error("Slack OAuth exchange failed:", data.error);
      res.status(400).send("Slack workspace connection failed.");
      return;
    }

    await prisma.slackConnection.upsert({
      where: { userId },
      update: {
        teamId: data.team.id,
        teamName: data.team.name,
        botUserId: data.bot_user_id,
        accessTokenEncrypted: encryptToken(data.access_token),
      },
      create: {
        userId,
        teamId: data.team.id,
        teamName: data.team.name,
        botUserId: data.bot_user_id,
        accessTokenEncrypted: encryptToken(data.access_token),
      },
    });

    res.redirect(`${process.env.FRONTEND_URL}/?slack=connected`);
  } catch (error) {
    console.error("Slack callback error:", error);
    res.status(500).send("Could not complete Slack connection.");
  }
});

export default router;
