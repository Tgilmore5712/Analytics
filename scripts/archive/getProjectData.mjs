import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getData() {
  const projectId = '598134326244946';
  
  // Get original staging record
  const staging = await prisma.$queryRawUnsafe(
    `SELECT * FROM procore_project_staging WHERE procore_project_id = $1`,
    projectId
  );
  
  // Get all unpacked fields
  const unpacked = await prisma.procoreProjectStagingUnpackedField.findMany({
    where: {
      procoreProjectId: projectId
    },
    orderBy: { fieldPath: 'asc' }
  });
  
  console.log('=== STAGING RECORD ===');
  if (staging && staging.length > 0) {
    const s = staging[0];
    console.log('ID:', s.id);
    console.log('Company ID:', s.company_id);
    console.log('External ID:', s.external_id);
    console.log('Procore Project ID:', s.procore_project_id);
    console.log('Name:', s.name);
    console.log('Display Name:', s.display_name);
    console.log('Project Number:', s.project_number);
    console.log('Status:', s.status);
    console.log('Customer:', s.customer);
    console.log('Source:', s.source);
    console.log('Synced At:', s.synced_at);
    console.log('Payload (raw):', typeof s.payload === 'string' ? s.payload.substring(0, 200) + '...' : JSON.stringify(s.payload).substring(0, 200) + '...');
  } else {
    console.log('No staging record found');
  }
  
  console.log('\n=== UNPACKED FIELDS (' + unpacked.length + ') ===');
  unpacked.forEach(u => {
    const val = u.valueText || u.valueNumber || u.valueBoolean || u.valueJson;
    console.log(u.fieldPath + ': [' + u.valueType + '] ' + val);
  });
  
  await prisma.$disconnect();
  process.exit(0);
}

getData().catch(e => { 
  console.error('Error:', e.message); 
  process.exit(1); 
});
