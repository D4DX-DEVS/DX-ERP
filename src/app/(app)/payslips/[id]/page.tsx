import { forbidden, notFound } from "next/navigation";
import { can, requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { PageBody, PageHeader } from "@/components/ui/page";
import { loadPayslipPage } from "../data";
import { PayslipDownload, PayslipView } from "../payslip-view";

export const metadata = { title: "Payslip" };

export default async function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const result = await loadPayslipPage(user, id);
  if (result.state === "forbidden") forbidden();
  if (result.state !== "ok") notFound();
  const { data } = result;
  const settings = await getSettings();
  const ownPage = data.owner;
  return (
    <PageBody>
      <PageHeader
        back={!ownPage && can(user, "payroll.view") ? { href: `/payroll/${data.slip.run}`, label: "Payroll run" } : undefined}
        overline={ownPage ? "Pay & claims · only you, HR and Finance can see this" : undefined}
        title={ownPage ? "My payslips" : `Payslip · ${data.slip.snapshot.name}`}
        actions={<PayslipDownload id={data.slip._id.toString()} />}
      />
      <PayslipView data={data} company={settings.company} footer={settings.documents.payslipFooter} />
    </PageBody>
  );
}
