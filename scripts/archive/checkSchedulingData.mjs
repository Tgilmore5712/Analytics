import { PrismaClient } from '@prisma/client/edge.js';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

async function check() {
  try {
    console.log('=== Checking IN_PROGRESS projects in staging ===');
    const count = await prisma.procoreProjectStaging.count({
      where: {
        source: 'procore_v1_projects',
        bidBoardStatus: 'IN_PROGRESS',
      }
    });
    console.log('IN_PROGRESS projects in staging:', count);

    const samples = await prisma.procoreProjectStaging.findMany({
      where: {
        source: 'procore_v1_projects',
        bidBoardStatus: 'IN_PROGRESS',
      },
      take: 3,
      select: { 
        externalId: true, 
        name: true, 
        bidBoardStatus: true,
        companyId: true,
        syncedAt: true 
      }
    });
    console.log('Sample projects:', JSON.stringify(samples, null, 2));

    console.log('\n=== Checking budget line items ===');
    const budgetCount = await prisma.budgetLineItem.count();
    console.log('Total budget line items:', budgetCount);

    const budgetSamples = await prisma.budgetLineItem.findMany({
      take: 3,
      select: {
        budgetLineItemId: true,
        projectId: true,
        companyId: true,
        quantity: true,
        amount: true,
      }
    });
    console.log('Sample budget items:', JSON.stringify(budgetSamples, null, 2));

    console.log('\n=== Checking Schedule table ===');
    const scheduleCount = await prisma.schedule.count();
    console.log('Total schedules:', scheduleCount);

    const scheduleSamples = await prisma.schedule.findMany({
      take: 3,
      select: {
        jobKey: true,
        projectName: true,
        totalHours: true,
        allocationsList: {
          take: 2,
          select: { period: true, percent: true }
        }
      }
    });
    console.log('Sample schedules:', JSON.stringify(scheduleSamples, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

check();
