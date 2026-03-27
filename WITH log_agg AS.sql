WITH log_agg AS (
  SELECT
    pl."lineItemHolderNumber" AS po_number,
    pl."lineItemHolderTitle"  AS scope_title,

    -- Keep the numbered label for display (ex: "#1 - Ready Mix Concrete For Foundations")
    TRIM(
      REGEXP_REPLACE(
        COALESCE(pl."scopeOfWork", pl."lineItemDescription", ''),
        '\s*-\s*[-+]?\d+(?:\.\d+)?\s+[A-Za-z]+$',
        ''
      )
    ) AS description_display,

    -- Normalized key for joining to budget descriptions
    LOWER(TRIM(
      REGEXP_REPLACE(
        COALESCE(pl."lineItemDescription", pl."scopeOfWork", ''),
        '^#\d+\s*-\s*',
        ''
      )
    )) AS description_key,

    SUM(COALESCE(pl."quantityUsed", 0)) AS qty_used
  FROM "ProductivityLog" pl
  WHERE pl."lineItemHolderNumber" IS NOT NULL
    AND pl."lineItemHolderTitle" IS NOT NULL
  GROUP BY
    pl."lineItemHolderNumber",
    pl."lineItemHolderTitle",
    TRIM(
      REGEXP_REPLACE(
        COALESCE(pl."scopeOfWork", pl."lineItemDescription", ''),
        '\s*-\s*[-+]?\d+(?:\.\d+)?\s+[A-Za-z]+$',
        ''
      )
    ),
    LOWER(TRIM(
      REGEXP_REPLACE(
        COALESCE(pl."lineItemDescription", pl."scopeOfWork", ''),
        '^#\d+\s*-\s*',
        ''
      )
    ))
),
budget_agg AS (
  SELECT
    po.number AS po_number,
    po.title  AS scope_title,
    LOWER(TRIM(li.description)) AS description_key,
    SUM(COALESCE(li.quantity, 0)) AS budgeted_qty
  FROM "PurchaseOrderContract" po
  LEFT JOIN "PurchaseOrderLineItemContractDetail" li
    ON li."purchaseOrderContractId" = po.id
  GROUP BY
    po.number,
    po.title,
    LOWER(TRIM(li.description))
)
SELECT
  p."projectName",
  p.customer AS customer_name,
  po.number  AS po_number,
  po.title   AS scope_title,
  la.description_display AS description,   -- matches your column label in screenshot
  COALESCE(ba.budgeted_qty, 0) AS budgeted_qty,
  la.qty_used
FROM log_agg la
JOIN "PurchaseOrderContract" po
  ON po.number = la.po_number
 AND po.title  = la.scope_title
LEFT JOIN "Project" p
  ON p.id = po."projectId"
LEFT JOIN budget_agg ba
  ON ba.po_number = la.po_number
 AND ba.scope_title = la.scope_title
 AND ba.description_key = LOWER(TRIM(
       REGEXP_REPLACE(la.description_display, '^#\d+\s*-\s*', '')
     ))
WHERE po."jobKey" = 'cmmm0z0670007e3ek9zcle94u'
ORDER BY
  p."projectName",
  po.number,
  la.description_display;