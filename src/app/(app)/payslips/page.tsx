import { forbidden, notFound } from "next/navigation";
import { isInternLike, requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { ButtonLink } from "@/components/ui/button";
import { Banknote } from "lucide-react";
import { loadPayslipPage } from "./data";
import { PayslipDownload, PayslipView } from "./payslip-view";

export const metadata = { title: "My payslips" };

export default async function MyPayslipsPage() {
  const user = await requireUser();
  const result = await loadPayslipPage(user);
  if (result.state === "forbidden") forbidden();
  if (result.state === "notfound") notFound();
  const title = isInternLike(user) ? "My stipend" : "My payslips";

  if (result.state === "empty") {
    return (
      <PageBody>
        <PageHeader overline="Pay & claims · only you, HR and Finance can see this" title={title} />
        <div className="rounded-[14px] border border-line bg-white">
          <EmptyState
            icon={<Banknote className="size-5" />}
            title="No payslips yet"
            description="Your payslip appears here once the month's payroll has been approved. You will get a notification when it is paid."
            action={user.personType === "admin" ? <ButtonLink href="/payroll">Open payroll</ButtonLink> : undefined}
          />
        </div>
      </PageBody>
    );
  }

  const settings = await getSettings();
  return (
    <PageBody>
      <PageHeader overline="Pay & claims · only you, HR and Finance can see this" title={title} actions={<PayslipDownload id={result.data.slip._id.toString()} />} />
      <PayslipView data={result.data} company={settings.company} footer={settings.documents.payslipFooter} />
    </PageBody>
  );
}
