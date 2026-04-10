const response = await fetch('http://localhost:3000/api/scheduling/projects-with-budget?bidBoardStatus=IN_PROGRESS&companyId=598134325658789');
const data = await response.json();

console.log('=== API Response ===');
console.log('Success:', data.success);
console.log('Count:', data.count);
console.log('Log:', data._log);
console.log('Status:', data.bidBoardStatus);

if (data.data && data.data.length > 0) {
  console.log('\nFirst 3 projects:');
  data.data.slice(0, 3).forEach((p, i) => {
    console.log(`  ${i+1}. ${p.projectId} - ${p.projectName} (Budget: $${p.totalAmount})`);
  });
}
