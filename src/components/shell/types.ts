export interface ShellUser {
  id: string;
  name: string;
  email: string;
  photo?: string;
  roleName: string;
  employeeId: string;
  title: string;
  isStaff: boolean;
}

export interface Presence {
  state: "in" | "out" | "not_in" | "checked_out" | "leave" | "holiday" | "none";
  label: string;
}
