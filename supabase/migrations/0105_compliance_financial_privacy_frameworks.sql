-- Compliance Agent — COMPLIANCE-P0-13 Financial and privacy control
-- frameworks (2026-10-01, explicit user request: SOX and other financial
-- compliance; GDPR and DPDP). Owner: Compliance Agent.
--
-- Additive catalogue data only, the same global, read-only treatment as
-- 0036's frameworks. As there: representative control sets mapped to what
-- WonderID can evidence (access reviews, SoD, provisioning, audit trail,
-- incidents, privacy rights), not full control libraries. Mapping a
-- control and attaching evidence never makes a tenant "SOX compliant" or
-- "PCI compliant" (CLAUDE.md §10 item 10): it is evidence for the
-- customer's own auditors.

insert into control_frameworks (id, display_name) values
  ('sox_itgc', 'SOX §404 IT General Controls'),
  ('soc1', 'SOC 1 (SSAE 18 / ISAE 3402)'),
  ('pci_dss', 'PCI DSS v4.0.1'),
  ('glba', 'GLBA Safeguards Rule (16 CFR 314)'),
  ('dora', 'EU DORA (Regulation 2022/2554)'),
  ('rbi_itgrc', 'RBI Master Direction on IT Governance, Risk, Controls and Assurance (2023)'),
  ('sebi_cscrf', 'SEBI Cybersecurity and Cyber Resilience Framework (2024)'),
  ('cert_in', 'CERT-In Directions under s.70B(6) IT Act (2022)'),
  ('gdpr', 'EU / UK GDPR'),
  ('dpdp', 'India Digital Personal Data Protection Act 2023 and Rules 2025')
on conflict (id) do nothing;

insert into controls (framework_id, control_ref, requirement) values
  ('sox_itgc', 'APD-01', 'Logical access to financially significant systems is requested, authorized and approved before it is granted'),
  ('sox_itgc', 'APD-02', 'Access is removed promptly for terminated and transferred users'),
  ('sox_itgc', 'APD-03', 'User access to financially significant systems is reviewed and recertified periodically'),
  ('sox_itgc', 'APD-04', 'Privileged and administrative access is restricted, approved and monitored'),
  ('sox_itgc', 'APD-05', 'Segregation-of-duties conflicts are prevented or detected and remediated'),
  ('sox_itgc', 'APD-06', 'Service, machine and AI-agent accounts have an accountable owner and least-privilege access'),
  ('sox_itgc', 'PC-01', 'Changes to configuration and policies are authorized, versioned and approved before taking effect'),
  ('sox_itgc', 'CO-01', 'Audit trails are complete, protected from modification and retained for the required period'),
  ('sox_itgc', 'CO-02', 'Interface and job failures (integrations, syncs) are monitored and resolved'),
  ('soc1', 'CC-LA', 'Logical access to in-scope systems is restricted to authorized personnel and reviewed'),
  ('soc1', 'CC-CM', 'Changes to in-scope systems are authorized, tested and approved'),
  ('soc1', 'CC-OP', 'Processing exceptions and incidents are identified, tracked and resolved'),
  ('pci_dss', 'SAQ-A', 'Cardholder data entry and processing are fully outsourced to PCI DSS validated service providers'),
  ('pci_dss', '7.2.1', 'An access control model is defined that grants least-privilege access based on job function'),
  ('pci_dss', '7.2.4', 'User accounts and their access privileges are reviewed at least every six months'),
  ('pci_dss', '8.4.2', 'Multi-factor authentication is used for all administrative access'),
  ('pci_dss', '10.2.1', 'Audit logs are enabled and active for all system components'),
  ('pci_dss', '10.3.2', 'Audit log files are protected to prevent modification'),
  ('pci_dss', '10.5.1', 'Audit log history is retained for at least 12 months'),
  ('pci_dss', '12.8.1', 'A list of third-party service providers with which account data is shared is maintained'),
  ('glba', '314.4(c)(1)', 'Access controls limit authorized users to the customer information they need'),
  ('glba', '314.4(c)(5)', 'Multi-factor authentication is implemented for any individual accessing information systems'),
  ('glba', '314.4(c)(8)', 'Activity of authorized users is monitored and logged, and unauthorized access detected'),
  ('glba', '314.4(h)', 'A written incident response plan is established'),
  ('dora', 'Art. 9(4)(c)', 'Policies limit physical and logical access to what is required, with strong authentication'),
  ('dora', 'Art. 17', 'An ICT-related incident management process detects, manages and notifies incidents'),
  ('dora', 'Art. 19', 'Major ICT-related incidents are reported to the competent authority'),
  ('dora', 'Art. 28(3)', 'A register of information on all contractual arrangements with ICT third-party service providers is maintained'),
  ('rbi_itgrc', 'AC-1', 'Role-based access with least privilege, approved provisioning and periodic access review'),
  ('rbi_itgrc', 'AC-2', 'Privileged user access is controlled and its activity logged and monitored'),
  ('rbi_itgrc', 'AL-1', 'Audit trails are maintained, protected and reviewed'),
  ('rbi_itgrc', 'IR-1', 'Cyber incidents are reported to the RBI within six hours of detection'),
  ('sebi_cscrf', 'PR.AA', 'Identity management, authentication and access control, including periodic review'),
  ('sebi_cscrf', 'DE.CM', 'Continuous security monitoring detects anomalous activity'),
  ('sebi_cscrf', 'RS.MA', 'Incidents are managed and reported within prescribed timelines'),
  ('sebi_cscrf', 'GV.SC', 'Third-party and supply-chain cybersecurity risk is managed'),
  ('cert_in', 'D-ii', 'Cyber incidents are reported to CERT-In within six hours of being noticed'),
  ('cert_in', 'D-iv', 'Logs of all ICT systems are retained securely for a rolling 180 days within India'),
  ('cert_in', 'D-i', 'System clocks are synchronised to an authoritative time source'),
  ('gdpr', 'Art. 5(1)(e)', 'Personal data is kept no longer than necessary (storage limitation)'),
  ('gdpr', 'Art. 7', 'Consent is demonstrable, specific and as easy to withdraw as to give'),
  ('gdpr', 'Art. 12-22', 'Data-subject rights requests are answered within one month (extendable by two)'),
  ('gdpr', 'Art. 25', 'Data protection by design and by default'),
  ('gdpr', 'Art. 30', 'Records of processing activities are maintained'),
  ('gdpr', 'Art. 32', 'Appropriate technical and organisational security measures, including access control'),
  ('gdpr', 'Art. 33-34', 'Personal-data breaches are notified to the authority within 72 hours and to individuals when high risk'),
  ('gdpr', 'Art. 44-46', 'International transfers rely on adequacy or appropriate safeguards'),
  ('dpdp', 's.5', 'A notice in clear language precedes or accompanies every request for consent'),
  ('dpdp', 's.6', 'Consent is free, specific, informed, unambiguous and withdrawable with comparable ease'),
  ('dpdp', 's.8(5)', 'Reasonable security safeguards prevent personal-data breaches'),
  ('dpdp', 's.8(6)', 'Personal-data breaches are intimated to the Data Protection Board and each affected Data Principal'),
  ('dpdp', 's.8(7)', 'Personal data is erased when its purpose is served or consent is withdrawn, unless retention is required by law'),
  ('dpdp', 's.8(9)-(10)', 'Contact details of the Data Protection Officer or responsible person are published and grievances are redressed'),
  ('dpdp', 's.11-14', 'Data Principal rights to access, correction, erasure, grievance redressal and nomination are honoured'),
  ('dpdp', 'Rule 8(3)', 'Logs of personal-data processing are retained for at least one year')
on conflict (framework_id, control_ref) do nothing;
