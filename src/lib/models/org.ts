import { defineModel, ObjectIdType, Schema, type ObjectId } from "./_base";

export interface IDepartment {
  _id: ObjectId;
  name: string;
  code?: string;
  head?: ObjectId;
  description?: string;
  active: boolean;
}

const DepartmentSchema = new Schema<IDepartment>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, trim: true, uppercase: true },
    head: { type: ObjectIdType, ref: "User" },
    description: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Department = defineModel<IDepartment>("Department", DepartmentSchema);

export interface IDesignation {
  _id: ObjectId;
  name: string;
  department?: ObjectId;
  level?: number;
  active: boolean;
}

const DesignationSchema = new Schema<IDesignation>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    department: { type: ObjectIdType, ref: "Department" },
    level: Number,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Designation = defineModel<IDesignation>("Designation", DesignationSchema);

export interface IRole {
  _id: ObjectId;
  key: string;
  name: string;
  description?: string;
  permissions: string[];
  system: boolean;
}

const RoleSchema = new Schema<IRole>(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: String,
    permissions: { type: [String], default: [] },
    system: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Role = defineModel<IRole>("Role", RoleSchema);

export interface IHoliday {
  _id: ObjectId;
  date: string;
  name: string;
  optional: boolean;
}

const HolidaySchema = new Schema<IHoliday>(
  {
    date: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    optional: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Holiday = defineModel<IHoliday>("Holiday", HolidaySchema);
