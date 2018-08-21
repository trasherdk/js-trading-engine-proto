const userBalances = {};

const DEFAULT_INIT_BALANCE = 100000n;

async function getBalance(userId, currencyTicker) {
  let balanceObj = userBalances[userId];
  if (balanceObj === undefined) {
    balanceObj = userBalances[userId] = {
      [currencyTicker]: DEFAULT_INIT_BALANCE,
    }
  }

  const currentBalance = balanceObj[currencyTicker];
  if (currentBalance === undefined) {
    return Promise.resolve(balanceObj[currencyTicker] = DEFAULT_INIT_BALANCE);
  }

  return Promise.resolve(currentBalance);
}

/**
 * Alters an user's balance by the given delta value ; optionally will _not_ fail if insufficient balance
 * @param {string} userId
 * @param {string} currencyTicker
 * @param {BigInt} deltaBalance
 * @param {boolean} failOnNegativeBalance
 */
async function alterBalance(userId, currencyTicker, deltaBalance, failOnNegativeBalance = true) {
  let balanceObj = userBalances[userId];
  if (balanceObj === undefined) {
    balanceObj = userBalances[userId] = {
      [currencyTicker]: DEFAULT_INIT_BALANCE,
    }
  }

  if (balanceObj[currencyTicker] === undefined) {
    balanceObj[currencyTicker] = DEFAULT_INIT_BALANCE;
  }

  if (balanceObj[currencyTicker] + deltaBalance < 0n && failOnNegativeBalance) {
    return Promise.resolve(false);
  }

  balanceObj[currencyTicker] += deltaBalance;

  return Promise.resolve(true);
}

async function getBalances() {
  return Object.keys(userBalances).reduce((acc, userId) => {
    acc[userId] = Object.keys(userBalances[userId]).reduce((balanceAcc, ticker) => Object.assign(balanceAcc, {
      [ticker]: `${userBalances[userId][ticker]}`,
    }), {});
    return acc;
  }, {});
}

module.exports = {
  getBalance,
  alterBalance,
  getBalances,
}
