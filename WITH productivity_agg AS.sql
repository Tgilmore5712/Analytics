WITH productivity_agg AS (
  SELECT
    pl."lineItemHolderNumber" AS po_number,
    pl."lineItemHolderTitle"  AS scope_title,
    COALESCE(SUM(pl."quantityUsed"), 0) AS qty_used_aggregated
  FROM "ProductivityLog" pl
  GROUP BY
    pl."lineItemHolderNumber",
    pl."lineItemHolderTitle"
)
SELECT
  p."projectName",
  p.customer                           AS customer_name,
  po.number                            AS po_number,
  po.title                             AS scope_title,
  po.status                            AS po_status,
  po.jobKey                            AS job_key,

  li.description,
  li."costCode",
  li.uom,
  li.quantity                          AS budgeted_qty,
  pa.qty_used_aggregated               AS qty_used

FROM "PurchaseOrderContract" po
LEFT JOIN "Project" p
  ON p.id = po."projectId"
LEFT JOIN "PurchaseOrderLineItemContractDetail" li
  ON li."purchaseOrderContractId" = po.id
LEFT JOIN productivity_agg pa
  ON pa.po_number = po.number
  AND pa.scope_title = po.title
WHERE po."jobKey" = 'cmmm0z0670007e3ek9zcle94u'
ORDER BY po.number, li.position NULLS LAST, li.description;



