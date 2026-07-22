SELECT "storeName", "cashInitial", "balanceInitial" FROM "Settings";
SELECT name, "sortOrder" FROM "Category" ORDER BY "sortOrder";
SELECT name, stock, "sellPrice" FROM "Product" ORDER BY name;
SELECT COUNT(*) AS total_products FROM "Product";
SELECT COUNT(*) AS total_categories FROM "Category";
SELECT COUNT(*) AS total_subcategories FROM "Subcategory";
