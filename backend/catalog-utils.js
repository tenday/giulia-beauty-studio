/**
 * GIULIA BEAUTY STUDIO — Service Catalog Normalization & Seed Builder
 */
const { DEFAULT_STUDIO_CATALOG } = require('../catalog');

function slugifyCatalogKey(raw, prefix = 'srv') {
  const base = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix ? `${prefix}-` : ''}${base || 'item'}-${rand}`;
}

function buildDefaultCatalogSeed() {
  const categories = [];
  const services = [];

  (DEFAULT_STUDIO_CATALOG || []).forEach((cat, catIdx) => {
    const slug = String(cat.id || `cat-${catIdx + 1}`).trim();
    categories.push({
      slug,
      title: String(cat.title || slug.toUpperCase()).trim(),
      motto: cat.motto ? String(cat.motto).trim() : null,
      column_side: cat.column === 'left' ? 'left' : 'right',
      sort_order: (catIdx + 1) * 10,
      active: 1,
    });

    let srvIdx = 0;
    (cat.subgroups || []).forEach((sg) => {
      const subgroupLabel = sg && sg.label ? String(sg.label).trim() : null;
      (sg.items || []).forEach((item) => {
        srvIdx += 1;
        services.push({
          service_key: String(item.id || `${slug}-${srvIdx}`).trim(),
          category_slug: slug,
          subgroup_label: subgroupLabel,
          name: String(item.name || '').trim(),
          price: Number(Number(item.price || 0).toFixed(2)),
          duration_minutes: Math.max(5, Number.parseInt(item.duration || '30', 10) || 30),
          description: item.desc ? String(item.desc).trim() : null,
          sort_order: srvIdx * 10,
          active: 1,
          show_in_storefront: 1,
        });
      });
    });
  });

  return { categories, services };
}

function normalizeCategoryRow(row) {
  return {
    id: Number(row.id),
    slug: String(row.slug || '').trim(),
    title: String(row.title || '').trim(),
    motto: row.motto ? String(row.motto).trim() : '',
    column_side: row.column_side === 'left' ? 'left' : 'right',
    sort_order: Number(row.sort_order || 0),
    active: Number(row.active ?? 1) === 1 ? 1 : 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function normalizeServiceRow(row) {
  return {
    id: Number(row.id),
    service_key: String(row.service_key || '').trim(),
    category_slug: String(row.category_slug || '').trim(),
    subgroup_label: row.subgroup_label ? String(row.subgroup_label).trim() : '',
    name: String(row.name || '').trim(),
    price: Number(Number(row.price || 0).toFixed(2)),
    duration_minutes: Math.max(5, Number.parseInt(row.duration_minutes || '30', 10) || 30),
    description: row.description ? String(row.description).trim() : '',
    sort_order: Number(row.sort_order || 0),
    active: Number(row.active ?? 1) === 1 ? 1 : 0,
    show_in_storefront: Number(row.show_in_storefront ?? 1) === 1 ? 1 : 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function sortByOrderThenId(a, b) {
  const oa = Number(a.sort_order || 0);
  const ob = Number(b.sort_order || 0);
  if (oa !== ob) return oa - ob;
  return Number(a.id || 0) - Number(b.id || 0);
}

function buildStructuredCatalog(
  rawCategories = [],
  rawServices = [],
  { includeInactive = false, storefrontOnly = false } = {}
) {
  const cats = (rawCategories || [])
    .map(normalizeCategoryRow)
    .filter((c) => includeInactive || c.active === 1)
    .sort(sortByOrderThenId);

  const services = (rawServices || [])
    .map(normalizeServiceRow)
    .filter((s) => {
      if (!includeInactive && s.active !== 1) return false;
      if (storefrontOnly && s.show_in_storefront !== 1) return false;
      return true;
    })
    .sort(sortByOrderThenId);

  return cats
    .map((cat) => {
      const catServices = services.filter((s) => s.category_slug === cat.slug);
      const subgroupMap = new Map();
      const subgroups = [];
      catServices.forEach((srv) => {
        const key = srv.subgroup_label || '__default__';
        if (!subgroupMap.has(key)) {
          const groupObj = {
            label: srv.subgroup_label || null,
            items: [],
          };
          subgroupMap.set(key, groupObj);
          subgroups.push(groupObj);
        }
        subgroupMap.get(key).items.push({
          id: srv.service_key,
          db_id: srv.id,
          name: srv.name,
          price: srv.price,
          duration: srv.duration_minutes,
          desc: srv.description,
          subgroup: srv.subgroup_label,
          sort_order: srv.sort_order,
          active: srv.active,
          show_in_storefront: srv.show_in_storefront,
        });
      });

      return {
        id: cat.slug,
        db_id: cat.id,
        column: cat.column_side,
        title: cat.title,
        motto: cat.motto,
        sort_order: cat.sort_order,
        active: cat.active,
        subgroups,
      };
    })
    .filter((cat) => includeInactive || cat.subgroups.length > 0);
}

module.exports = {
  DEFAULT_STUDIO_CATALOG,
  slugifyCatalogKey,
  buildDefaultCatalogSeed,
  normalizeCategoryRow,
  normalizeServiceRow,
  sortByOrderThenId,
  buildStructuredCatalog,
};
