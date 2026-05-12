export interface RiskProfile {
  risk: 'Low' | 'Medium' | 'High';
  downtime: string;
  reversible: boolean;
  recommendedTime: 'Anytime' | 'Off-hours recommended';
  impacts: string[];
  automated: boolean;
  actionVerb: string;   // e.g. "Delete", "Resize", "Enable"
}

export interface RemediationContext {
  type: 'idle' | 'rightsizing' | 'ahb' | 'storage' | 'databases' | 'reservations';
  recommendationId: string;   // rowKey of the recommendation entity
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionId: string;
  monthlySaving: number;
  // VM rightsizing
  currentSku?: string;
  recommendedSku?: string;
  // AHB
  powershellCommand?: string;
  // Storage/DB
  recommendation?: string;
  details?: Record<string, unknown>;
  // Reservations
  term?: '1Year' | '3Year';
  notes?: string;
}

export function getRiskProfile(
  type: RemediationContext['type'],
  resourceType: string
): RiskProfile {
  switch (type) {
    case 'idle': {
      const rt = resourceType.toLowerCase();
      if (rt.includes('load balancer')) {
        return {
          risk: 'High',
          downtime: 'None (but traffic may break)',
          reversible: false,
          recommendedTime: 'Off-hours recommended',
          automated: true,
          actionVerb: 'Delete',
          impacts: [
            'Load balancer will be permanently deleted',
            'Any traffic routed through this LB will fail',
            'Verify no services depend on it before proceeding',
          ],
        };
      }
      if (rt.includes('disk')) {
        return {
          risk: 'Medium',
          downtime: 'None',
          reversible: false,
          recommendedTime: 'Anytime',
          automated: true,
          actionVerb: 'Delete',
          impacts: [
            'Disk will be permanently deleted',
            'Data cannot be recovered without a backup/snapshot',
            'Confirm no VM is still using this disk',
          ],
        };
      }
      return {
        risk: 'Low',
        downtime: 'None',
        reversible: false,
        recommendedTime: 'Anytime',
        automated: true,
        actionVerb: 'Delete',
        impacts: [
          `${resourceType} will be permanently deleted`,
          'IP addresses or network configurations will be released',
        ],
      };
    }

    case 'rightsizing':
      return {
        risk: 'High',
        downtime: '5–15 minutes',
        reversible: true,
        recommendedTime: 'Off-hours recommended',
        automated: true,
        actionVerb: 'Resize',
        impacts: [
          'VM will be stopped (deallocated)',
          'Hardware profile will be updated to the new size',
          'VM will be started automatically after resize',
          'All services on this VM will be unavailable during the resize window',
          'Applications must tolerate the restart',
        ],
      };

    case 'ahb': {
      const isSql = resourceType.toLowerCase().includes('sql');
      if (isSql) {
        return {
          risk: 'Low',
          downtime: 'None',
          reversible: true,
          recommendedTime: 'Anytime',
          automated: false,
          actionVerb: 'Enable (manual)',
          impacts: [
            'SQL VM IaaS Agent extension must be used to enable AHB',
            'No restart or downtime required',
            'PowerShell command will be provided to run manually',
          ],
        };
      }
      return {
        risk: 'Low',
        downtime: 'None',
        reversible: true,
        recommendedTime: 'Anytime',
        automated: true,
        actionVerb: 'Enable',
        impacts: [
          'License type changed to Windows_Server (Hybrid Benefit)',
          'No VM restart required',
          'Savings take effect on the next billing cycle',
        ],
      };
    }

    case 'storage': {
      if (resourceType === 'Premium Disk') {
        return {
          risk: 'Medium',
          downtime: 'Brief I/O pause if attached',
          reversible: true,
          recommendedTime: 'Off-hours recommended',
          automated: true,
          actionVerb: 'Downgrade',
          impacts: [
            'Disk SKU will change from Premium SSD to Standard SSD',
            'IOPS and throughput limits will be reduced',
            'If attached to a running VM, a brief I/O interruption may occur',
            'Performance should be verified after downgrade',
          ],
        };
      }
      if (resourceType === 'Storage Account') {
        return {
          risk: 'High',
          downtime: 'None (data permanently lost)',
          reversible: false,
          recommendedTime: 'Off-hours recommended',
          automated: false,
          actionVerb: 'Delete (manual)',
          impacts: [
            'Storage account and ALL contained data will be permanently deleted',
            'Blobs, tables, queues and file shares will be lost',
            'Any applications depending on this storage will fail',
            'CLI commands will be provided to review and delete safely',
          ],
        };
      }
      // Log Analytics
      return {
        risk: 'Low',
        downtime: 'None',
        reversible: true,
        recommendedTime: 'Anytime',
        automated: true,
        actionVerb: 'Reduce retention',
        impacts: [
          'Log Analytics retention will be reduced to 31 days (free tier)',
          'Logs older than 31 days will be purged gradually',
          'No impact on current monitoring or alerting',
        ],
      };
    }

    case 'databases': {
      if (resourceType === 'Azure SQL Database') {
        return {
          risk: 'Medium',
          downtime: 'Brief (connection reset)',
          reversible: true,
          recommendedTime: 'Off-hours recommended',
          automated: true,
          actionVerb: 'Scale down',
          impacts: [
            'Database DTU capacity will be reduced',
            'Active connections may be briefly dropped during scaling',
            'Query performance may decrease if actual load exceeds new limit',
            'Monitor query performance after scaling',
          ],
        };
      }
      // Cosmos DB
      return {
        risk: 'Medium',
        downtime: 'Varies',
        reversible: false,
        recommendedTime: 'Off-hours recommended',
        automated: false,
        actionVerb: 'Migrate (manual)',
        impacts: [
          'Switching from Provisioned to Serverless requires creating a new account',
          'Data must be migrated between accounts',
          'Azure Portal steps and documentation link will be provided',
        ],
      };
    }

    case 'reservations':
      return {
        risk: 'Low',
        downtime: 'None',
        reversible: true,
        recommendedTime: 'Anytime',
        automated: false,
        actionVerb: 'Purchase (manual)',
        impacts: [
          'Reserved Instance must be purchased through the Azure Portal or CLI',
          'Commitment period applies (1 or 3 years) — review cancellation policy',
          'Savings begin immediately once the RI is purchased',
        ],
      };
  }
}

export function buildActionDescription(ctx: RemediationContext): string {
  switch (ctx.type) {
    case 'idle':
      return `Delete ${ctx.resourceType}: ${ctx.resourceName}`;
    case 'rightsizing':
      return `Resize VM ${ctx.resourceName} from ${ctx.currentSku ?? '?'} → ${ctx.recommendedSku ?? '?'}`;
    case 'ahb':
      return `Enable Azure Hybrid Benefit on ${ctx.resourceName} (${ctx.resourceType})`;
    case 'storage':
      if (ctx.resourceType === 'Premium Disk') return `Downgrade disk ${ctx.resourceName} from Premium SSD to Standard SSD`;
      if (ctx.resourceType === 'Log Analytics Workspace') return `Reduce ${ctx.resourceName} retention to 31 days`;
      return `Review and delete Storage Account: ${ctx.resourceName}`;
    case 'databases':
      if (ctx.resourceType === 'Azure SQL Database') {
        const cap = (ctx.details?.recommendedCapacity as number | undefined) ?? '?';
        return `Scale SQL Database ${ctx.resourceName} to ${cap} DTU`;
      }
      return `Migrate Cosmos DB ${ctx.resourceName} to Serverless`;
    case 'reservations':
      return `Purchase ${ctx.term ?? '1Year'} Reserved Instance for ${ctx.resourceName}`;
  }
}
