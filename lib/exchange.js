const EventEmitter = require('events');

const uuid = require('uuid');
const Bluebird = require('bluebird');

const { getBalance, alterBalance } = require('./balances');
const { OrderSide, OrderBook, OrderBookRow } = require('./entities');

const orderBookEvents = new EventEmitter();
const orderBook = new OrderBook('FUN', 'BUX');

async function getOrderBook() {
  const output = {
    base: orderBook.baseTicker,
    quote: orderBook.quoteTicker,
    buy: [],
    sell: [],
  };

  ['buy', 'sell'].forEach((side) => {
    output[`${side}Amount`] = `${orderBook[side].amount}`;
    output[`${side}Value`] = `${orderBook[side].value}`;

    // Iterate prices and print order book
    orderBook[side].prices.each((priceEntry) => {
      output[side].push({
        price: `${priceEntry.price}`,
        amount: `${priceEntry.amount}`,
        value: `${priceEntry.value}`,
        entries: priceEntry.entries.map((order) => ({
          id: order.id,
          amount: `${order.amount}`,
          value: `${order.value}`,
        })),
      });
    })
  });

  return Promise.resolve(output);
}

function compareBuy(left, right) {
  if (left > right) {
    return -1;
  }

  if (left < right) {
    return 1;
  }

  return 0;
}

function compareSell(left, right) {
  if (left > right) {
    return 1;
  }

  if (left < right) {
    return -1;
  }

  return 0;
}

async function placeOrder(userId, side, amountAsNumber, priceAsNumber) {
  const orderId = uuid.v4();

  const isLimitOrder = BigInt(priceAsNumber || 0n) > 0;

  const amountBigInt = BigInt(amountAsNumber);
  const priceBigInt = BigInt(priceAsNumber || 0n);
  const valueBigInt = isLimitOrder ? amountBigInt * priceBigInt : 0n;

  const ourSide = side === OrderSide.BUY ? orderBook.buy : orderBook.sell;
  const otherSide = side === OrderSide.BUY ? orderBook.sell : orderBook.buy;
  const compareFn = side === OrderSide.BUY ? compareBuy : compareSell;
  const otherTicker = side === OrderSide.BUY ? orderBook.quoteTicker : orderBook.baseTicker;
  const ourFullVal = side === OrderSide.BUY ? valueBigInt : amountBigInt;

  // In case of a limit order, we also have a target price
  // so we might just end up placing an order on the order book
  if (isLimitOrder) {
    const firstOtherSideRow = otherSide.prices.min();

    // Figure out if we're above the other side's first entry (or the other side is empty)
    if (firstOtherSideRow === null || compareFn(firstOtherSideRow.price, priceBigInt) < 0) {
      // We've gotta check the balance right away because we're going to use up all the value
      // when placing the order
      const availableBalance = await getBalance(userId, side === OrderSide.BUY ? orderBook.baseTicker : orderBook.quoteTicker);
      if (availableBalance < ourFullVal) {
        // Insufficient balance
        return Promise.resolve(false);
      }

      // We are above the other side's first entry so just place the order in the
      // order book and return
      ourSide.pushEntry(userId, priceBigInt, amountBigInt, orderId);
      orderBookEvents.emit('place', {
        userId,
        side,
        price: priceBigInt,
        amount: amountBigInt,
      });

      await alterBalance(
        userId,
        side === OrderSide.BUY ? orderBook.quoteTicker : orderBook.baseTicker,
        -1n * ourFullVal);
      return Promise.resolve(true);
    }
  }

  let runningAmount = 0n;
  let runningValue = 0n;

  let leftoverAmount = amountBigInt;

  let affectedOrderBookRows = [];
  let affectedOrderBookEntries = [];
  let partiallyAffectedOrderBookEntry = null;

  // While we've still got amount, we try to keep trading with the order book entries
  // (up to the specified price, if one _was_ specified)
  const it = otherSide.prices.iterator();
  for (let orderBookRow = it.next(); orderBookRow !== null; orderBookRow = it.next()) {
    // First check that we're not running over the price limit, if provided
    if (isLimitOrder && compareFn(orderBookRow.price, priceBigInt) < 0) {
      break;
    }

    runningPrice = orderBookRow.price;

    // Check if we can buy the entire order book row
    if (orderBookRow.amount <= leftoverAmount) {
      affectedOrderBookRows.push(orderBookRow);
      runningAmount += orderBookRow.amount;
      runningValue += orderBookRow.value;

      leftoverAmount -= orderBookRow.amount;
    } else {
      for (let idx = 0; idx < orderBookRow.entries.length; idx += 1) {
        const orderBookEntry = orderBookRow.entries[idx];
        if (orderBookEntry.amount <= leftoverAmount) {
          affectedOrderBookEntries.push(orderBookEntry);
          runningAmount += orderBookEntry.amount;
          runningValue += orderBookEntry.value;

          leftoverAmount -= orderBookEntry.amount;
        } else {
          partiallyAffectedOrderBookEntry = {
            orderBookEntry,
            amount: leftoverAmount,
            value: leftoverAmount * orderBookRow.price,
          };
          runningAmount += partiallyAffectedOrderBookEntry.amount;
          runningValue += partiallyAffectedOrderBookEntry.value;

          leftoverAmount -= partiallyAffectedOrderBookEntry.amount;
        }

        break;
      }
    }

    if (leftoverAmount <= 0n) {
      break;
    }
  }

  // First check that the user has the required amounts in balance
  const availableBalance = await getBalance(userId, side === OrderSide.BUY ? orderBook.baseTicker : orderBook.quoteTicker);
  const requiredBalance = isLimitOrder
    ? ourFullVal
    : (side === OrderSide.BUY ? runningValue : runningAmount);
  if (availableBalance < requiredBalance) {
    // Insufficient balance
    return Promise.resolve(false);
  }

  const tradeEvents = [];
  const userBalanceChanges = [];
  // Balance is sufficient, now update the in-memory data structures
  affectedOrderBookRows.forEach((orderBookRow) => {
    orderBookRow.entries.forEach((orderBookEntry) => {
      tradeEvents.push({
        userId: orderBookEntry.userId,
        side: otherSide,
        price: orderBookRow.price,
        amount: orderBookEntry.amount,
      });

      userBalanceChanges.push({
        userId: orderBookEntry.userId,
        ticker: otherTicker,
        balance: side === OrderSide.BUY ? orderBookEntry.value : orderBookEntry.amount,
      });
    });

    otherSide.removeRow(orderBookRow.price);
  });

  affectedOrderBookEntries.forEach((orderBookEntry) => {
    tradeEvents.push({
      userId: orderBookEntry.userId,
      side: otherSide,
      price: orderBookEntry.orderBookRow.price,
      amount: orderBookEntry.amount,
    });

    userBalanceChanges.push({
      userId: orderBookEntry.userId,
      ticker: otherTicker,
      balance: side === OrderSide.BUY ? orderBookEntry.value : orderBookEntry.amount,
    });

    orderBookEntry.orderBookRow.amount -= orderBookEntry.amount;
    orderBookEntry.orderBookRow.value -= orderBookEntry.value;
    orderBookEntry.orderBookRow.entries.splice(orderBookEntry.orderBookRow.entries.indexOf(orderBookEntry), 1);
  });

  if (partiallyAffectedOrderBookEntry) {
    tradeEvents.push({
      userId: partiallyAffectedOrderBookEntry.orderBookEntry.userId,
      side: otherSide,
      price: partiallyAffectedOrderBookEntry.orderBookEntry.orderBookRow.price,
      amount: partiallyAffectedOrderBookEntry.amount,
    });

    userBalanceChanges.push({
      userId: partiallyAffectedOrderBookEntry.orderBookEntry.userId,
      ticker: otherTicker,
      balance: side === OrderSide.BUY ? partiallyAffectedOrderBookEntry.value : partiallyAffectedOrderBookEntry.amount,
    });

    partiallyAffectedOrderBookEntry.orderBookEntry.amount -= partiallyAffectedOrderBookEntry.amount;
    partiallyAffectedOrderBookEntry.orderBookEntry.value -= partiallyAffectedOrderBookEntry.value;

    partiallyAffectedOrderBookEntry.orderBookEntry.orderBookRow.amount -= partiallyAffectedOrderBookEntry.amount;
    partiallyAffectedOrderBookEntry.orderBookEntry.orderBookRow.value -= partiallyAffectedOrderBookEntry.value;
  }

  tradeEvents.forEach((event) => {
    orderBookEvents.emit('trade', event);
    orderBookEvents.emit('trade', Object.assign({}, event, {
      userId,
      side,
    }));
  });

  await Bluebird.mapSeries(userBalanceChanges, async (userBalanceChange) => {
    return await alterBalance(userBalanceChange.userId, userBalanceChange.ticker, userBalanceChange.balance);
  });

  await alterBalance(
    userId,
    side === OrderSide.BUY ? orderBook.quoteTicker : orderBook.baseTicker,
    -1n * (side === OrderSide.BUY ? runningValue : runningAmount));
  await alterBalance(
    userId,
    side === OrderSide.BUY ? orderBook.baseTicker : orderBook.quoteTicker,
    side === OrderSide.BUY ? runningAmount : runningValue);

  if (leftoverAmount && isLimitOrder) {
    ourSide.pushEntry(userId, priceBigInt, leftoverAmount, orderId);

    orderBookEvents.emit('place', {
      userId,
      side,
      price: priceBigInt,
      amount: leftoverAmount,
    });

    await alterBalance(
      userId,
      side === OrderSide.BUY ? orderBook.quoteTicker : orderBook.baseTicker,
      -1n * (side === OrderSide.BUY ? leftoverAmount : (leftoverAmount * priceBigInt)));
  }

  return Promise.resolve(true);
}

async function cancelOrder(orderId) {
  const snapshot = orderBook.cancelOrder(orderId);
  if (!snapshot) {
    return Promise.resolve(false);
  }

  await alterBalance(
    snapshot.userId,
    snapshot.side === OrderSide.BUY ? orderBook.quoteTicker : orderBook.baseTicker,
    snapshot.side === OrderSide.BUY ? snapshot.value : snapshot.amount);
  orderBookEvents.emit('cancel', snapshot);

  return Promise.resolve(true);
}

module.exports = {
  orderBookEvents,
  getOrderBook,
  placeOrder,
  cancelOrder,
};
