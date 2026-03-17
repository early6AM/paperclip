import type { GoalLevel, GoalStatus } from "../constants.js";
import type { StartsAtPrecision } from "./issue.js";

export interface Goal {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  level: GoalLevel;
  status: GoalStatus;
  parentId: string | null;
  ownerAgentId: string | null;
  startsAt: Date | null;
  startsAtPrecision: StartsAtPrecision | null;
  createdAt: Date;
  updatedAt: Date;
}
