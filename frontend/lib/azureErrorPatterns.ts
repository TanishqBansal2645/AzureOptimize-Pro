export interface ErrorPattern {
  title: string;
  explanation: string;
  suggestions: string[];
  docLink?: string;
}

export const AZURE_ERROR_PATTERNS: Record<string, ErrorPattern> = {
  SkuNotAvailable: {
    title: 'SKU Not Available in This Region',
    explanation:
      'The requested VM size or disk SKU is not available in this Azure region or availability zone right now.',
    suggestions: [
      'Check which SKUs are available: az vm list-skus --location <region> --size Standard_D --output table',
      'Try a different VM size in the same family (one tier smaller or larger)',
      'Retry in a few minutes — Azure capacity fluctuates throughout the day',
    ],
    docLink:
      'https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-machines/virtual-machines-availability-set-supportability',
  },

  QuotaExceeded: {
    title: 'Subscription vCPU Quota Exceeded',
    explanation:
      'Your subscription has reached its vCPU or resource quota limit for this VM family in this region.',
    suggestions: [
      'Request a quota increase: Azure Portal → Subscriptions → Usage + Quotas → Request Increase',
      'Check current usage: az vm list-usage --location <region> --output table',
      'Try a different region where quota is available, if the workload allows',
    ],
    docLink: 'https://learn.microsoft.com/en-us/azure/quotas/regional-quota-requests',
  },

  AuthorizationFailed: {
    title: 'Managed Identity Missing Permissions',
    explanation:
      'The Function App managed identity does not have the required RBAC role to perform this operation.',
    suggestions: [
      'Assign Contributor role to the managed identity: az role assignment create --assignee <principal-id> --role Contributor --scope /subscriptions/<id>',
      'List current role assignments: az role assignment list --assignee <principal-id>',
      'For disk SKU changes, the managed identity needs Microsoft.Compute/disks/write on the disk resource',
    ],
    docLink:
      'https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-portal',
  },

  ResourceNotFound: {
    title: 'Resource No Longer Exists',
    explanation:
      'The resource was deleted or moved between when it was scanned and when remediation was attempted.',
    suggestions: [
      'Trigger a fresh scan from the top-right refresh button to update recommendations',
      'Verify the resource exists in Azure Portal',
      'This recommendation can be dismissed — it is no longer applicable',
    ],
  },

  AllocationFailed: {
    title: 'Azure Capacity Unavailable',
    explanation:
      "Azure does not have enough physical capacity for the requested VM size in this region or zone at this time.",
    suggestions: [
      'Retry in 5–15 minutes — capacity is usually freed up quickly',
      'Try a different availability zone in the same region',
      'Try a comparable VM size in a different family (e.g., Ddsv5 instead of Dsv5)',
    ],
    docLink:
      'https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-machines/allocation-failure',
  },

  RequestDisallowed: {
    title: 'Blocked by Azure Policy',
    explanation:
      'An Azure Policy in this subscription or management group is blocking this operation.',
    suggestions: [
      'List active policies: az policy assignment list --scope /subscriptions/<id>',
      'Check which policy is blocking: look for policies restricting VM sizes, disk SKUs, or allowed regions',
      'Contact your Azure administrator to add an exemption for this resource',
    ],
    docLink: 'https://learn.microsoft.com/en-us/azure/governance/policy/overview',
  },

  OperationNotAllowed: {
    title: 'Operation Not Permitted',
    explanation:
      'This operation is not allowed — possibly due to a resource lock, a management group restriction, or the current resource state.',
    suggestions: [
      'Check for resource locks: az lock list --resource <resource-id>',
      'Remove a ReadOnly lock if present: az lock delete --name <lock-name> --resource <resource-id>',
      'Ensure the VM is in a valid state (not in a failed provisioning state)',
    ],
    docLink:
      'https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/lock-resources',
  },

  LinkedAuthorizationFailed: {
    title: 'Cross-Subscription Permission Error',
    explanation:
      'The operation requires permissions on a linked resource (e.g., a disk or NIC) that lives in a different subscription.',
    suggestions: [
      'Assign the Contributor role to the managed identity in the linked subscription as well',
      'Run: az role assignment create --assignee <principal-id> --role Contributor --scope /subscriptions/<linked-sub-id>',
    ],
  },

  InternalServerError: {
    title: 'Transient Azure Service Error',
    explanation: 'Azure encountered an internal error. These are almost always temporary.',
    suggestions: [
      'Wait 2–5 minutes and retry the operation',
      'Check Azure Service Health for active incidents in your region: https://status.azure.com',
      'If the error persists for more than 30 minutes, open an Azure support ticket',
    ],
    docLink: 'https://status.azure.com',
  },

  ServiceUnavailable: {
    title: 'Azure Service Temporarily Unavailable',
    explanation: 'The Azure service is temporarily unavailable in this region.',
    suggestions: [
      'Wait a few minutes and retry',
      'Check the Azure status page for regional outages: https://status.azure.com',
    ],
    docLink: 'https://status.azure.com',
  },

  Conflict: {
    title: 'Resource Conflict',
    explanation:
      'Another operation is already running on this resource, or the resource is in a conflicting state.',
    suggestions: [
      'Wait for any in-progress Azure operations on this resource to complete (check Activity Log in Portal)',
      'Retry after 1–2 minutes',
    ],
  },

  InvalidSku: {
    title: 'Invalid Database SKU',
    explanation: 'The requested DTU value or service tier combination is not valid for this Azure SQL database.',
    suggestions: [
      'Valid Standard DTU values: 10, 20, 50, 100, 200, 400, 800, 1600, 3000',
      'Basic tier is fixed at 5 DTU — cannot specify a custom value',
      'Check current tier: az sql db show --name <db> --server <server> --resource-group <rg>',
    ],
    docLink: 'https://learn.microsoft.com/en-us/azure/azure-sql/database/resource-limits-dtu-single-databases',
  },

};
