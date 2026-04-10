/**
 * Seeds cost_code_categories from the company's master cost code list.
 * Safe to re-run — uses upsert on cost_code (unique key).
 * Add new codes here as the company's master list grows.
 *
 * Usage: node scripts/seedCostCodeCategories.mjs
 */

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

// Source of truth: CostCodeMapp.csv provided by Paradise Masonry
// canonicalCode: when set, all codes in that category roll up to this one code in reports.
// The 4 multi-code labor categories each get a canonical code in XX-XXX-XX-XX format.
const COST_CODES = [
  { itemType: 'Labor', name: 'Bollards Labor',              description: 'Labor To Set And Pour Bollards',                               costName: 'Bollards Labor',            costCode: '05-100-10-30', category: 'Site Labor',           canonicalCode: '03-300-30-10' },
  { itemType: 'Labor', name: 'Foundation Labor',            description: 'General Labor for Concrete foundations',                       costName: 'Foundation Concrete Labor', costCode: '03-300-00-10', category: 'Foundation Labor',     canonicalCode: '03-300-00-10' },
  { itemType: 'Labor', name: 'Foundation Forms Labor',      description: 'Labor To Form Foundations',                                    costName: 'Foundation Forms Labor',    costCode: '03-100-10-10', category: 'Foundation Labor',     canonicalCode: '03-300-00-10' },
  { itemType: 'Labor', name: 'Foundation Rebar Labor',      description: 'General Labor To Place Rebar',                                 costName: 'Foundation Rebar Labor',    costCode: '03-200-10-10', category: 'Foundation Labor',     canonicalCode: '03-300-00-10' },
  { itemType: 'Labor', name: 'Continuous Footing Labor',    description: 'Labor To Prep And Pour Continuous Footings / 150 Ft. = 36 Hrs.', costName: 'Continuous Footing Labor', costCode: '03-300-00-12', category: 'Foundation Labor',   canonicalCode: '03-300-00-10' },
  { itemType: 'Labor', name: 'Spreadfooting Labor',         description: 'Labor To Prep And Pour Spreadfootings / 1 = 6 hrs.',           costName: 'Spread Footing Labor',      costCode: '03-300-00-16', category: 'Foundation Labor',     canonicalCode: '03-300-00-10' },
  { itemType: 'Labor', name: 'Pier Labor',                  description: 'Labor To Prep And Pour Piers / 1 = 8 Hrs.',                    costName: 'Pier Labor',                costCode: '03-300-00-14', category: 'Foundation Labor',     canonicalCode: '03-300-00-10' },
  { itemType: 'Labor', name: 'Wall Forms Labor',            description: 'Labor To Form And Strip Poured Walls',                         costName: 'Wall Forms Labor',          costCode: '03-100-20-10', category: 'Wall Labor',           canonicalCode: '03-300-10-10' },
  { itemType: 'Labor', name: 'Wall Labor',                  description: 'General Labor For Poured Walls',                               costName: 'Wall Concrete Labor',       costCode: '03-300-10-10', category: 'Wall Labor',           canonicalCode: '03-300-10-10' },
  { itemType: 'Labor', name: 'Wall Rebar Labor',            description: 'Labor To Install Rebar In Walls',                              costName: 'Wall Rebar Labor',          costCode: '03-200-20-10', category: 'Wall Labor',           canonicalCode: '03-300-10-10' },
  { itemType: 'Labor', name: 'Labor Slab On Grade',         description: 'General Labor For Slabs On Grade',                             costName: 'Labor SOG Concrete',        costCode: '03-300-20-10', category: 'Slab On Grade Labor',  canonicalCode: '03-300-20-10' },
  { itemType: 'Labor', name: 'Slab on Grade Rebar Labor',   description: 'General Labor To Place Rebar',                                 costName: 'SOG Rebar Labor',           costCode: '03-200-30-10', category: 'Slab On Grade Labor',  canonicalCode: '03-300-20-10' },
  { itemType: 'Labor', name: 'Non Contracted Labor',        description: 'Non Contracted Labor',                                         costName: 'Non Contracted Labor',      costCode: '03-300-20-70', category: 'Non Contracted Labor', canonicalCode: null           },
  { itemType: 'Labor', name: 'Site Concrete Labor',         description: 'General Labor For Site Concrete',                              costName: 'Site Concrete Labor',       costCode: '03-300-30-10', category: 'Site Labor',           canonicalCode: '03-300-30-10' },
  { itemType: 'Labor', name: 'Site Rebar Labor',            description: 'General Labor To Place Rebar',                                 costName: 'Site Rebar Labor',          costCode: '03-200-40-10', category: 'Site Labor',           canonicalCode: '03-300-30-10' },
  { itemType: 'Labor', name: 'Demo Labor',                  description: 'Demo Labor Per Hour',                                          costName: 'Demo Labor',                costCode: '02-400-10-10', category: 'Demo Labor',           canonicalCode: null           },
  { itemType: 'Labor', name: 'Concrete Sawing Labor',       description: 'Labor To Cut Concrete',                                        costName: 'Concrete Sawing Labor',     costCode: '03-400-10-10', category: 'Concrete Sawing Labor', canonicalCode: null          },
  { itemType: 'Labor', name: 'Remediation Labor',           description: 'Concrete Remediation Per Hour',                                costName: 'Remediation Labor',         costCode: '02-500-10-10', category: 'Remediation Labor',    canonicalCode: null           },
  { itemType: 'Labor', name: 'Travel Labor',                description: 'Travel Labor Hourly',                                          costName: 'Travel Labor',              costCode: '01-300-10-30', category: 'Travel Labor',         canonicalCode: null           },
  { itemType: 'Labor', name: 'Waterstop Labor',             description: 'Labor To Install Waterstop',                                   costName: 'Waterstop Labor',           costCode: '03-150-10-10', category: 'Site Labor',           canonicalCode: '03-300-30-10' },
  { itemType: 'Labor', name: 'Interior Sealer Labor',       description: 'Labor to seal interior concrete',                              costName: 'Concrete Interior Labor',   costCode: '03-300-40-70', category: 'Slab On Grade Labor',  canonicalCode: '03-300-20-10' },
  { itemType: 'Labor', name: 'Stone Grading Labor',         description: 'Labor To Grade Stone',                                         costName: 'Grading Labor',             costCode: '31-100-10-10', category: 'Site Labor',           canonicalCode: '03-300-30-10' },
  { itemType: 'Labor', name: 'Excavation And Backfill Labor', description: 'Labor To Excavate And Backfill Foundations',                 costName: 'Excavation & Fill Labor',   costCode: '31-100-10-20', category: 'Foundation Labor',     canonicalCode: '03-300-00-10' },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const row of COST_CODES) {
    // Check if exists
    const existing = await prisma.$queryRawUnsafe(
      `SELECT id FROM cost_code_categories WHERE cost_code = $1 LIMIT 1`,
      row.costCode
    );

    if (existing.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE cost_code_categories
         SET cost_name = $1, category = $2, item_type = $3, name = $4,
             description = $5, canonical_code = $6, updated_at = NOW()
         WHERE cost_code = $7`,
        row.costName, row.category, row.itemType, row.name,
        row.description ?? null, row.canonicalCode ?? null, row.costCode
      );
      updated++;
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO cost_code_categories
           (id, cost_code, cost_name, category, item_type, name, description, canonical_code, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, NOW(), NOW())`,
        randomUUID(), row.costCode, row.costName, row.category,
        row.itemType, row.name, row.description ?? null, row.canonicalCode ?? null
      );
      created++;
    }
  }

  const [{ total }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS total FROM cost_code_categories`
  );
  console.log(`Done. Created: ${created}, Updated: ${updated}, Total in DB: ${total}`);

  // Print a quick category summary
  const summary = await prisma.$queryRawUnsafe(`
    SELECT category, COUNT(*)::int AS codes
    FROM cost_code_categories
    WHERE is_active = TRUE
    GROUP BY category
    ORDER BY category
  `);
  console.table(summary);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
