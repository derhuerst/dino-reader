'use strict'

const {DateTime} = require('luxon')
const Bitfield = require('bitfield')
const {Writable} = require('stream')
const parallel = require('async/parallel')

const mergeStations = require('./merge-stations')

const TIMEZONE = 'Europe/Berlin'

const parseCalendar = (days, from, until) => {
	days = new Bitfield(Buffer.from(days, 'hex'))
	const res = []

	until = DateTime.fromISO(until, {zone: TIMEZONE})
	let d = DateTime.fromISO(from, {zone: TIMEZONE})
	const startMonth = d.month
	while (d < until) {
		const i = (d.month - startMonth) * 32 + (32 - d.day)
		if (days.get(i)) res.push([d / 1000 | 0, d.weekday])
		d = d.plus({days: 1})
	}

	return res
}

const reduce = (acc, reducer, stream, cb) => {
	const write = (row, _, cb) => {
		reducer(acc, row, cb)
	}

	const out = new Writable({objectMode: true, write})

	let done = false
	out
	.once('error', (err) => {
		if (done) return null
		done = true
		cb(err)
		out.destroy(err)
	})
	.once('finish', (err) => {
		if (err || done) return null
		done = true
		cb(null, acc)
	})
	stream.pipe(out)
}

const readRestrictions = (readFile, done) => {
	const writeRestriction = (restrictions, row, cb) => {
		const id = row.RESTRICTION.trim()
		restrictions[id] = {
			id,
			name: row.RESTRICT_TEXT1.trim(),
			days: parseCalendar(
				row.RESTRICTION_DAYS.trim(),
				row.DATE_FROM.trim(),
				row.DATE_UNTIL.trim()
			)
		}
		cb()
	}

	reduce(
		Object.create(null),
		writeRestriction,
		readFile('service_restriction.din'),
		done
	)
}

const readRoutes = (readFile, done) => {
	const writeRoute = (routes, row, cb) => {
		const lineId = row.LINE_NR.trim()
		const id = lineId + '-' + row.STR_LINE_VAR.trim()
		routes[id] = {
			id,
			lineId,
			name: row.LINE_NAME.trim(),
			// todo: map MOT_NO/TMOT_NO to FPTF modes
			stops: [] // filled later
		}
		cb()
	}

	reduce(
		Object.create(null),
		writeRoute,
		readFile('rec_lin_ber.din'),
		done
	)
}

const readRouteStops = (routes, readFile, done) => {
	const writeRouteStop = (routes, row, cb) => {
		const id = row.LINE_NR.trim() + '-' + row.STR_LINE_VAR.trim()
		const route = routes[id]
		if (!route) return cb(new Error('unknown id ' + id))
		// todo: sort by row.LINE_CONSEC_NR?
		const lastStop = route.stops[route.stops.length - 1]
		route.stops.push({
			i: parseInt(row.LINE_CONSEC_NR),
			id: row.STOP_NR.trim(),
			distanceTravelled: (
				parseInt(row.LENGTH) +
				(lastStop && lastStop.distanceTravelled || 0)
			)
			// todo: STOP_TYPE_NR, STOPPING_POINT_NR, STOPPING_POINT_TYPE
		})
		cb()
	}

	reduce(
		routes,
		writeRouteStop,
		readFile('lid_course.din'),
		done
	)
}

const readWeekdays = (readFile, done) => {
	const writeWeekday = (weekdays, row, cb) => {
		// todo: take row.DAY from calendar_of_the_company.din into account
		const bitmask = parseInt(row.DAY_ATTRIBUTE_NR)
		const weekday = []
		weekday[1] = !!(bitmask & 64),
		weekday[2] = !!(bitmask & 32),
		weekday[3] = !!(bitmask & 16),
		weekday[4] = !!(bitmask & 8),
		weekday[5] = !!(bitmask & 4),
		weekday[6] = !!(bitmask & 2),
		weekday[7] = !!(bitmask & 1)

		weekdays[row.DAY_ATTRIBUTE_NR.trim()] = weekday
		cb()
	}

	reduce(
		Object.create(null),
		writeWeekday,
		readFile('day_type_2_day_attribute.din'),
		done
	)
}

const readTravelTimes = (readFile, done) => {
	const time = Symbol('time')
	const writeTravelTimes = (travelTimes, row, cb) => {
		const routeId = row.LINE_NR.trim() + '-' + row.STR_LINE_VAR.trim()
		const id = routeId + '-' + row.TIMING_GROUP_NR.trim()
		let travelTime = travelTimes[id]
		if (!travelTime) {
			travelTime = travelTimes[id] = {
				type: 'schedule',
				id,
				route: routeId,
				sequence: [],
				starts: [],
				[time]: 0
			}
		}
		const arrival = travelTime[time] + parseInt(row.TT_REL)
		const departure = arrival + parseInt(row.STOPPING_TIME)
		travelTime[time] = departure
		travelTime.sequence.push({arrival, departure})
		cb()
	}

	reduce(
		Object.create(null),
		writeTravelTimes,
		readFile('lid_travel_time_type.din'),
		done
	)
}

const readTrips = (restrictions, travelTimes, weekdays, readFile, done) => {
	const writeTrips = (travelTimes, row, cb) => {
		const travelTimeId = [
			row.LINE_NR.trim(),
			row.STR_LINE_VAR.trim(),
			row.TIMING_GROUP_NR.trim()
		].join('-')
		const travelTime = travelTimes[travelTimeId]
		if (!travelTime) {
			console.error('unknown travelTime id ' + travelTimeId)
			return cb() // skip row
		}

		const restrictionId = row.RESTRICTION.trim()
		if (!restrictionId) {
			// todo: use row.DAY_ATTRIBUTE_NR here
			if (row.DAY_ATTRIBUTE_NR.trim() === '0') {
				return cb() // silently skip row
			}
			return cb(new Error(`invalid restriction id "${restrictionId}"`))
		}
		const restriction = restrictions[restrictionId]
		if (!restriction) {
			return cb(new Error('unknown restriction id ' + restrictionId))
		}

		const onWeekday = weekdays[row.DAY_ATTRIBUTE_NR.trim()] || []
		const dayOffset = parseInt(row.DEPARTURE_TIME)
		for (let [t, weekday] of restriction.days) {
			// The year-based bitmasks from restrictions and the week-based
			// bitmask from weekdays *both* need to be set to 1/true.
			if (onWeekday[weekday]) {
				travelTime.starts.push(t + dayOffset)
			}
		}

		// todo: VEH_TYPE_NR, ROUND_TRIP_ID, TRAIN_NR
		cb()
	}

	reduce(
		travelTimes,
		writeTrips,
		readFile('rec_trip.din'),
		done
	)
}

const createReader = (readFile) => {
	const readSchedules = (cb) => {
		parallel([
			cb => readRestrictions(readFile, cb),
			cb => readTravelTimes(readFile, cb),
			cb => readRoutes(readFile, cb),
			cb => readWeekdays(readFile, cb)
		], (err, [restrictions, travelTimes, routes, weekdays]) => {
			if (err) return cb(err)
			readTrips(restrictions, travelTimes, weekdays, readFile, (err, travelTimes) => {
				if (err) return cb(err)

				readRouteStops(routes, readFile, (err, routes) => {
					if (err) return cb(err)

					for (let travelTime of Object.values(travelTimes)) {
						const route = routes[travelTime.route]
						if (route) travelTime.route = route
					}
					cb(null, travelTimes)
				})
			})
		})
	}

	const readMergedStations = (cb) => {
		mergeStations(
			readFile('rec_stop.din'),
			readFile('rec_stopping_points.din'),
			cb
		)
	}

	return {
		readSchedules,
		readMergedStations
	}
}

module.exports = createReader
