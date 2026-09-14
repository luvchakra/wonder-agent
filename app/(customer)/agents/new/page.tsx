import { createAgentAction } from "@/app/actions/agents";
import { Card, CardHeader, CardBody, Button, TextField, SelectField } from "@/modules/ui";

// Matches IDENTITY-P0-01.1's worked example fields.
export default function NewAgentPage() {
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Register an AI Agent</h1>
      <Card>
        <CardHeader title="Agent details" description="Registers the canonical identity Identity Agent tracks through its lifecycle." />
        <CardBody>
          <form action={createAgentAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <TextField label="Agent name" name="agentName" required />
            </div>
            <div className="sm:col-span-2">
              <TextField label="Agent type" name="agentType" required placeholder="chatbot, automation, copilot, pipeline…" />
            </div>
            <div className="sm:col-span-2">
              <TextField label="Purpose" name="purpose" />
            </div>
            <TextField label="Framework" name="agentFramework" />
            <TextField label="Model provider" name="modelProvider" />
            <TextField label="Model name" name="modelName" />
            <TextField label="Runtime" name="runtime" placeholder="mcp, aws-lambda, on-prem…" />
            <SelectField label="Environment" name="environment" defaultValue="production">
              <option value="production">production</option>
              <option value="staging">staging</option>
              <option value="development">development</option>
            </SelectField>
            <SelectField label="Criticality" name="criticality" defaultValue="medium">
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </SelectField>
            <TextField label="Data classification" name="dataClassification" placeholder="financial, pii, confidential…" />
            <div className="sm:col-span-2">
              <Button type="submit">Register</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
