import { notFound, redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { getConsultationForAnswer } from "@/modules/certification-compliance/service";
import { Card, CardBody, CardHeader } from "@/modules/ui";
import { AnswerForm } from "./AnswerForm";

/** COMPLIANCE-P0-14 part 3: the page a member opens to answer an access review question put to them. */
export default async function ConsultationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx.tenantId) redirect("/sign-in");
  const { id } = await params;
  const c = await getConsultationForAnswer(ctx.tenantId, ctx.userId, id);
  if (!c) notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold text-foreground">An access review asks for your input</h1>
      <Card>
        <CardHeader title={c.about || "Access under review"} />
        <CardBody>
          <p className="whitespace-pre-wrap text-sm text-foreground">{c.question}</p>
          {c.answeredAt ? (
            <p className="mt-4 whitespace-pre-wrap rounded-md bg-muted p-3 text-sm text-foreground">{c.answer}</p>
          ) : (
            <AnswerForm consultationId={c.id} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
