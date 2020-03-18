
const { utils: { BigNumber: BN }} = require("ethers")

const log = require("debug")("Streamr::CPS::utils::events")

async function replayOn(plasma, events, messages) {
    const merged = mergeEventsWithMessages(events, messages)
    for (const event of merged) {
        await replayEvent(plasma, event)
    }
}

/** Transition the MonoplasmaState by given Ethereum event or Streamr stream message */
async function replayEvent(plasma, event) {
    const type = event.event || event.type     // stream messages have "type"
    switch (type) {
        // event Transfer(address indexed from, address indexed to, uint256 value);
        case "Transfer": {
            const revenueBN = new BN(event.args.value.toString())
            log(`${revenueBN} tokens received @ block ${event.blockNumber}`)
            plasma.addRevenue(revenueBN)
        } break
        // event BlockCreated(uint blockNumber, bytes32 rootHash, string ipfsHash);
        case "NewCommit": {
            const blockNumber = +event.args.blockNumber
            log(`Storing block ${blockNumber}`)
            await plasma.storeBlock(blockNumber)
        } break
        case "join": {
            const { addressList } = event
            plasma.addMembers(addressList)
        } break
        case "part": {
            const { addressList } = event
            plasma.removeMembers(addressList)
        } break
        // TODO: this event is not yet implemented in CPS (it is in Monoplasma...)
        case "OwnershipTransferred": {
            const { previousOwner, newOwner } = event.args
            log(`Owner (admin) address changed to ${newOwner} from ${previousOwner} @ block ${event.blockNumber}`)
            if (plasma.admin != previousOwner) {
                throw Error(`plasma admin stored in state ${plasma.admin} != previousOwner reported by OwnershipTransferred event ${previousOwner}`)
            }
            plasma.admin = newOwner
        } break
        case "AdminFeeChanged": {
            const { adminFee } = event.args
            log(`Admin fee changed to ${adminFee} @ block ${event.blockNumber}`)
            plasma.setAdminFeeFraction(adminFee.toString()) // TODO: .toString() not needed once Monoplasma supports ethers.utils.BigNumber
        } break
        default: {
            log(`WARNING: Unexpected ${type} event: ${JSON.stringify(event)}`)
        }
    }
}

/** Tests from "emptiness", for the purposes of event lists. Non-arrays are empty. */
function isEmpty(x) {
    return !Array.isArray(x) || x.length < 1
}

/**
 * Merge Ethereum events with Streamr messages by timestamp, Ethereum events come first if tied
 * Interpretation: e.g. BlockCreated "contains" all join/parts that happened BEFORE its timestamp
 * @param {List<Event>} events from Ethereum logs
 * @param {List<StreamrMessage>} messages from Streamr
 */
function mergeEventsWithMessages(events, messages) {
    if (isEmpty(events)) { return isEmpty(messages) ? [] : messages }
    if (isEmpty(messages)) { return isEmpty(events) ? [] : events }
    const ret = []
    let eventI = 0
    let msgI = 0
    let eventT = events[0].timestamp
    let msgT = messages[0].timestamp
    for (;;) {
        if (msgT < eventT) {
            ret.push(messages[msgI++])
            if (msgI >= messages.length) {
                return ret.concat(events.slice(eventI))
            }
            msgT = messages[msgI].timestamp
        } else {
            ret.push(events[eventI++])
            if (eventI >= events.length) {
                return ret.concat(messages.slice(msgI))
            }
            eventT = events[eventI].timestamp
        }
    }
}

function mergeEventLists(events1, events2) {
    if (isEmpty(events1)) { return isEmpty(events2) ? [] : events2 }
    if (isEmpty(events2)) { return isEmpty(events1) ? [] : events1 }
    const ret = []
    let i1 = 0
    let i2 = 0
    let block1 = events1[0].blockNumber
    let block2 = events2[0].blockNumber
    let txi1 = events1[0].transactionIndex
    let txi2 = events2[0].transactionIndex
    let li1 = events1[0].logIndex
    let li2 = events2[0].logIndex
    for (;;) {
        if (block1 < block2 || block1 === block2 && (txi1 < txi2 || txi1 === txi2 && li1 <= li2)) {
            ret.push(events1[i1++])
            if (i1 >= events1.length) {
                return ret.concat(events2.slice(i2))
            }
            block1 = events1[i1].blockNumber
            txi1 = events1[i1].transactionIndex
            li1 = events1[i1].logIndex
        } else {
            ret.push(events2[i2++])
            if (i2 >= events2.length) {
                return ret.concat(events1.slice(i1))
            }
            block2 = events2[i2].blockNumber
            txi2 = events2[i2].transactionIndex
            li2 = events2[i2].logIndex
        }
    }
}

module.exports = {
    mergeEventLists,
    mergeEventsWithMessages,
    replayEvent,
    replayOn,
}
