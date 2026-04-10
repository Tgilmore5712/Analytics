import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

try {
  // Check if color columns exist
  const cols = await prisma.$queryRaw`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'ProjectScope' 
    AND column_name IN ('color', 'taskColors')
  `;
  console.log('Columns found:', JSON.stringify(cols));

  const scope = await prisma.projectScope.findFirst({ select: { id: true, jobKey: true } });
  console.log('Test scope:', scope?.id, scope?.jobKey);

  if (scope) {
    // Test the exact query used in the API
    await prisma.$executeRawUnsafe(`UPDATE "ProjectScope" SET "color" = $1, "taskColors" = $2::jsonb WHERE id = $3`, '#FF0000', JSON.stringify({ TestTask: '#00FF00' }), scope.id);
    console.log('Update executed OK');
    const result = await prisma.$queryRawUnsafe(`SELECT id, "color", "taskColors" FROM "ProjectScope" WHERE id = $1`, scope.id);
    console.log('After update:', JSON.stringify(result));
  }
} catch(e) {
  console.error('Error:', e.message, e.code);
} finally {
  await prisma.$disconnect();
}
