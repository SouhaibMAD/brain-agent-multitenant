import { Redis } from "ioredis";
import { config } from "../config/index.js";

export const connection = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
});