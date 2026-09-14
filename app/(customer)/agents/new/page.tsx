import { createAgentAction } from "@/app/actions/agents";

// Bare functional form — matches IDENTITY-P0-01.1's worked example fields.
// Experience Agent (Module 08) owns visual design.
export default function NewAgentPage() {
  return (
    <main style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Register an AI Agent</h1>
      <form action={createAgentAction}>
        <label>
          Agent name *
          <input name="agentName" required style={{ display: "block", width: "100%", marginBottom: 12 }} />
        </label>
        <label>
          Agent type *
          <input
            name="agentType"
            required
            placeholder="chatbot, automation, copilot, pipeline…"
            style={{ display: "block", width: "100%", marginBottom: 12 }}
          />
        </label>
        <label>
          Purpose
          <input name="purpose" style={{ display: "block", width: "100%", marginBottom: 12 }} />
        </label>
        <label>
          Framework
          <input name="agentFramework" style={{ display: "block", width: "100%", marginBottom: 12 }} />
        </label>
        <label>
          Model provider
          <input name="modelProvider" style={{ display: "block", width: "100%", marginBottom: 12 }} />
        </label>
        <label>
          Model name
          <input name="modelName" style={{ display: "block", width: "100%", marginBottom: 12 }} />
        </label>
        <label>
          Runtime
          <input name="runtime" placeholder="mcp, aws-lambda, on-prem…" style={{ display: "block", width: "100%", marginBottom: 12 }} />
        </label>
        <label>
          Environment
          <select name="environment" style={{ display: "block", width: "100%", marginBottom: 12 }}>
            <option value="production">production</option>
            <option value="staging">staging</option>
            <option value="development">development</option>
          </select>
        </label>
        <label>
          Criticality
          <select name="criticality" style={{ display: "block", width: "100%", marginBottom: 12 }}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
        </label>
        <label>
          Data classification
          <input name="dataClassification" placeholder="financial, pii, confidential…" style={{ display: "block", width: "100%", marginBottom: 12 }} />
        </label>
        <button type="submit">Register</button>
      </form>
    </main>
  );
}
