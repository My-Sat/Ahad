require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');
const Order = require('../models/order');
const Printer = require('../models/printer');
const PrinterUsage = require('../models/printer_usage');
require('../models/service');
require('../models/service_cost_unit');
require('../models/service_cost_subunit');
const { resolvePrinterUsageType } = require('../utilities/printer_usage');

function validType(value) {
  return value === 'monochrome' || value === 'colour' ? value : null;
}

async function run() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is required');

  await mongoose.connect(uri);

  const usages = await PrinterUsage.find({
    type: null,
    orderRef: { $ne: null },
    itemIndex: { $gte: 0 }
  }).select('_id printer orderRef itemIndex count').lean();

  const orderIds = Array.from(new Set(usages.map(usage => String(usage.orderRef))));
  const orders = orderIds.length ? await Order.find({ _id: { $in: orderIds } })
    .select('items.service items.printer items.selections items.selectionLabel items.pricingMode items.printerType')
    .populate('items.service', 'name pricingMode')
    .populate('items.selections.unit', 'name')
    .populate('items.selections.subUnit', 'name')
    .lean() : [];
  const orderMap = new Map(orders.map(order => [String(order._id), order]));

  const usageUpdates = [];
  const orderSets = new Map();
  const inferredTotals = { monochrome: 0, colour: 0, unresolved: 0 };

  usages.forEach(usage => {
    const order = orderMap.get(String(usage.orderRef));
    const itemIndex = Number(usage.itemIndex);
    const item = order && Array.isArray(order.items) ? order.items[itemIndex] : null;
    const service = item && item.service && typeof item.service === 'object' ? item.service : null;
    const pricingMode = String((item && item.pricingMode) || (service && service.pricingMode) || '').toLowerCase();
    const type = validType(item && item.printerType) || resolvePrinterUsageType({
      ruleText: item && item.selectionLabel,
      selections: item && item.selections,
      serviceName: service && service.name,
      fallbackType: pricingMode === 'large_format' ? 'colour' : null
    });

    if (!type) {
      inferredTotals.unresolved += Number(usage.count || 0);
      return;
    }

    inferredTotals[type] += Number(usage.count || 0);
    usageUpdates.push({
      updateOne: {
        filter: { _id: usage._id, type: null },
        update: { $set: { type } }
      }
    });

    if (order && item && !validType(item.printerType)) {
      const orderId = String(order._id);
      if (!orderSets.has(orderId)) orderSets.set(orderId, {});
      orderSets.get(orderId)[`items.${itemIndex}.printerType`] = type;
    }
  });

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    candidateRecords: usages.length,
    inferredRecords: usageUpdates.length,
    inferredCounts: inferredTotals
  }, null, 2));

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to save the repair.');
    return;
  }

  if (usageUpdates.length) await PrinterUsage.bulkWrite(usageUpdates, { ordered: false });

  const orderUpdates = Array.from(orderSets.entries()).map(([orderId, set]) => ({
    updateOne: {
      filter: { _id: orderId },
      update: { $set: set }
    }
  }));
  if (orderUpdates.length) await Order.bulkWrite(orderUpdates, { ordered: false });

  const breakdowns = await PrinterUsage.aggregate([
    { $match: { type: { $in: ['monochrome', 'colour'] } } },
    {
      $group: {
        _id: '$printer',
        monochrome: {
          $sum: { $cond: [{ $eq: ['$type', 'monochrome'] }, '$count', 0] }
        },
        colour: {
          $sum: { $cond: [{ $eq: ['$type', 'colour'] }, '$count', 0] }
        }
      }
    }
  ]);
  const breakdownMap = new Map(breakdowns.map(row => [String(row._id), row]));
  const printers = await Printer.find().select('_id').lean();
  const printerUpdates = printers.map(printer => {
    const breakdown = breakdownMap.get(String(printer._id)) || {};
    return {
      updateOne: {
        filter: { _id: printer._id },
        update: {
          $set: {
            monochromeCount: Number(breakdown.monochrome || 0),
            colourCount: Number(breakdown.colour || 0)
          }
        }
      }
    };
  });
  if (printerUpdates.length) await Printer.bulkWrite(printerUpdates, { ordered: false });

  console.log(`Repaired ${usageUpdates.length} usage records and synchronized ${printers.length} printer breakdowns.`);
}

run()
  .then(() => mongoose.disconnect())
  .catch(async error => {
    console.error(error);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exitCode = 1;
  });
