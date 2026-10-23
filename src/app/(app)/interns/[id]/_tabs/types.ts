import type { CurrentUser } from "@/lib/auth/session";
import type { AppSettings } from "@/lib/config-defaults";
import type { Person, PersonRef } from "../../../staff/[id]/_tabs/types";
import type { InternAccess } from "../../_lib/access";

export type { Person, PersonRef };

export interface InternTabProps {
  user: CurrentUser;
  target: Person;
  access: InternAccess;
  settings: AppSettings;
  today: string;
  department?: string;
  designation?: string;
  mentor?: PersonRef;
  manager?: PersonRef;
}
