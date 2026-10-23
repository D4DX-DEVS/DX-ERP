import type { Types } from "mongoose";
import type { CurrentUser } from "@/lib/auth/session";
import type { AppSettings } from "@/lib/config-defaults";
import type { IUser } from "@/lib/models";
import type { PersonAccess } from "../../_lib/people-access";

/** Staff document as loaded for the profile (confidential fields are projected out of the query). */
export type Person = IUser & { _id: Types.ObjectId };

export interface PersonRef {
  id: string;
  name: string;
  photo?: string;
  sub?: string;
}

export interface TabProps {
  user: CurrentUser;
  person: Person;
  access: PersonAccess;
  settings: AppSettings;
  today: string;
}
