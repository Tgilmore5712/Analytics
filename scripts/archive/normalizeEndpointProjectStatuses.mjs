import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const STATUS_MAP = {
  'Course of Construction': 'In Progress',
  'Course of Constructions': 'In Progress',
  'course of construction': 'In Progress',
  'course of constructions': 'In Progress',
  'Post-Construction': 'Complete',
  'Post Construction': 'Complete',
  'post-construction': 'Complete',
  'post construction': 'Complete',
};

async function main() {
  let totalUpdated = 0;

  for (const [fromStatus, toStatus] of Object.entries(STATUS_MAP)) {
    const result = await prisma.project.updateMany({
      where: {
        procoreId: { not: null },
        status: fromStatus,
      },
      data: {
        status: toStatus,
      },
    });

    if (result.count > 0) {
      console.log(`${fromStatus} -> ${toStatus}: ${result.count}`);
      totalUpdated += result.count;
    }
  }

  console.log(`Total rows updated: ${totalUpdated}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
