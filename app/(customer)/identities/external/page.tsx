import { IdentityDirectory } from "../IdentityDirectory";

export default function Page({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  return <IdentityDirectory view="external" searchParams={searchParams} />;
}
