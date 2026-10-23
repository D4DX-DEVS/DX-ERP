import { can, getCurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Designation, User } from "@/lib/models";
import { createDoc, finalize, PDF_COLORS, pdfResponse, pdfText } from "@/lib/pdf/base";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { isObjectId } from "@/lib/validation";

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** Issued internship certificate as a PDF. Only the intern, their mentor and internship managers may download it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  const { id } = await params;
  if (!isObjectId(id)) return new Response("Not found", { status: 404 });

  await connectDB();
  const person = await User.findById(id, { name: 1, personType: 1, designation: 1, internship: 1 }).lean();
  if (!person || (person.personType !== "intern" && person.personType !== "trainee") || !person.internship) return new Response("Not found", { status: 404 });

  const allowed = user.id === id || person.internship.mentor?.toString() === user.id || can(user, "interns.manage");
  if (!allowed) return new Response("You don't have access to this certificate.", { status: 403 });
  const internship = person.internship;
  if (internship.certificateStatus !== "issued" || !internship.certificateNo) return new Response("The certificate has not been issued yet.", { status: 409 });

  const [settings, designation] = await Promise.all([getSettings(), person.designation ? Designation.findById(person.designation, { name: 1 }).lean() : null]);
  const company = settings.company;
  const companyName = company.legalName || company.name;
  const first = person.name.trim().split(/\s+/)[0] ?? person.name;
  const body = fill(settings.documents.certificateText, {
    name: person.name,
    firstName: first,
    company: companyName,
    role: internship.assignedRole || designation?.name || (person.personType === "trainee" ? "Trainee" : "Intern"),
    start: fmtDate(internship.startDate),
    end: fmtDate(internship.endDate),
  });

  const b = createDoc({
    title: "Certificate",
    company,
    orientation: "landscape",
    meta: [`Certificate No. ${internship.certificateNo}`, `Date ${fmtDate(internship.certificateIssuedAt)}`],
  });
  const { doc } = b;
  const mid = b.width / 2;
  let y = b.y + 14;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(...PDF_COLORS.brand);
  doc.text(pdfText(person.personType === "trainee" ? "CERTIFICATE OF TRAINING" : "CERTIFICATE OF INTERNSHIP"), mid, y, { align: "center" });
  y += 9;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...PDF_COLORS.muted);
  doc.text(pdfText(companyName), mid, y, { align: "center" });
  y += 18;

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...PDF_COLORS.ink);
  doc.text(pdfText(person.name), mid, y, { align: "center" });
  y += 5;
  doc.setDrawColor(...PDF_COLORS.line);
  doc.setLineWidth(0.4);
  doc.line(mid - 45, y, mid + 45, y);
  y += 12;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(...PDF_COLORS.ink);
  const lines = doc.splitTextToSize(pdfText(body), b.width - b.margin * 2 - 30) as string[];
  doc.text(lines, mid, y, { align: "center", lineHeightFactor: 1.6 });
  y += lines.length * 7.5 + 22;

  const pageH = doc.internal.pageSize.getHeight();
  const sigY = Math.min(Math.max(y, pageH - 52), pageH - 34);
  doc.setDrawColor(...PDF_COLORS.ink);
  doc.line(b.margin + 5, sigY, b.margin + 70, sigY);
  doc.setFontSize(9.5);
  doc.setTextColor(...PDF_COLORS.muted);
  doc.text("Authorised signatory", b.margin + 5, sigY + 5);
  doc.setTextColor(...PDF_COLORS.ink);
  doc.setFont("helvetica", "bold");
  doc.text(pdfText(companyName), b.margin + 5, sigY + 10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...PDF_COLORS.muted);
  doc.text(pdfText(`Issued ${fmtDate(internship.certificateIssuedAt)}`), b.width - b.margin - 5, sigY + 5, { align: "right" });

  finalize(b, `Certificate ${internship.certificateNo} - issued by ${companyName}`);
  return pdfResponse(doc, `Certificate-${internship.certificateNo}.pdf`);
}
