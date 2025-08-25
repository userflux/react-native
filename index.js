import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform, Dimensions, NativeModules, AppState, Linking } from 'react-native'
import DeviceInfo from 'react-native-device-info'
import NetInfo from '@react-native-community/netinfo'

class UserFlux {
	static ufApiKey = null
	static ufUserId = null
	static ufExternalId = null
	static ufTrackQueue = []
	static ufAnonymousId = ""
	static ufSessionId = null
	static ufSessionStartTime = null
	static ufLocationEnrichmentEnabled = true
	static ufDeviceDataEnrichmentEnabled = true
	static ufDefaultTrackingProperties = {}
	static ufDisableUserIdStorage = false
	static ufConsecutiveFailures = 0
	static ufMaxConsecutiveFailures = 3
	static ufRetryDelay = 1000
	static ufFlushInterval = null
	static ufAppStateSubscription = null
	static ufNetInfoSubscription = null
	static ufCurrentScreen = null
	static ufScreenStartTime = null
	static ufNavigationRef = null
	static ufSessionTimeout = 300000 // 5 minutes in milliseconds
	static ufLastActivityTime = Date.now()

	static initialize(apiKey, options = {}) {
		try {
			const shouldDisableCommonBotsBlocking = "blockCommonBots" in options && options["blockCommonBots"] == false
			
			// Bot detection is less relevant in React Native, but we can check for simulators/emulators
			if (!shouldDisableCommonBotsBlocking && UserFlux.isEmulatorOrSimulator()) {
				if (options.debugMode) {
					console.info("Emulator/Simulator detected. UserFlux SDK initializing in debug mode.")
				}
			}

			UserFlux.ufApiKey = apiKey

			if ("disableUserIdStorage" in options && options["disableUserIdStorage"] == true) {
				UserFlux.ufDisableUserIdStorage = true
			}

			// Load stored data
			UserFlux.loadStoredData().then(() => {
				UserFlux.ufAnonymousId = UserFlux.getOrCreateAnonymousId()
				UserFlux.ufUserId = UserFlux.getUserId()
				UserFlux.loadEventsFromStorage()

				if (!("trackSession" in options) || options["trackSession"] !== false) {
					UserFlux.setupSessionId()
				}

				if ("autoEnrich" in options && options["autoEnrich"] == false) {
					UserFlux.ufLocationEnrichmentEnabled = false
					UserFlux.ufDeviceDataEnrichmentEnabled = false
				}

				if ("defaultTrackingProperties" in options && typeof options["defaultTrackingProperties"] === "object") {
					UserFlux.ufDefaultTrackingProperties = options["defaultTrackingProperties"]
				}

				UserFlux.startFlushInterval()

				if ("autoCapture" in options) {
					UserFlux.setupAutoTracking(options["autoCapture"])
				}

				// Setup app state listener for session management
				UserFlux.setupAppStateListener()

				// Setup network connectivity listener
				UserFlux.setupNetworkListener()

				if (UserFlux.ufDisableUserIdStorage == true && UserFlux.ufUserId != null) {
					AsyncStorage.removeItem("uf-userId")
				}
			})
		} catch (error) {
			console.info("Failed to initialize UserFlux SDK: ", error)
		}
	}

	static setupAppStateListener() {
		UserFlux.ufAppStateSubscription = AppState.addEventListener('change', (nextAppState) => {
			if (nextAppState === 'active') {
				// App came to foreground
				const timeSinceLastActivity = Date.now() - UserFlux.ufLastActivityTime
				if (timeSinceLastActivity > UserFlux.ufSessionTimeout) {
					// Session expired, create new one
					UserFlux.setupSessionId()
				}
				UserFlux.ufLastActivityTime = Date.now()
			} else if (nextAppState === 'background') {
				// App went to background
				UserFlux.flush()
			}
		})
	}

	static setupNetworkListener() {
		UserFlux.ufNetInfoSubscription = NetInfo.addEventListener(state => {
			if (state.isConnected && UserFlux.ufTrackQueue.length > 0) {
				// Network reconnected, flush any pending events
				UserFlux.flush()
			}
		})
	}

	static cleanup() {
		if (UserFlux.ufAppStateSubscription) {
			UserFlux.ufAppStateSubscription.remove()
		}
		if (UserFlux.ufNetInfoSubscription) {
			UserFlux.ufNetInfoSubscription()
		}
		if (UserFlux.ufFlushInterval) {
			clearInterval(UserFlux.ufFlushInterval)
		}
	}

	static setNavigationRef(navigationRef) {
		UserFlux.ufNavigationRef = navigationRef
	}

	static async loadStoredData() {
		try {
			const [anonymousId, userId, externalId, events] = await AsyncStorage.multiGet([
				'uf-anonymousId',
				'uf-userId',
				'uf-externalId',
				'uf-track'
			])

			if (anonymousId[1]) UserFlux.ufAnonymousId = anonymousId[1]
			if (userId[1]) UserFlux.ufUserId = userId[1]
			if (externalId[1]) UserFlux.ufExternalId = externalId[1]
			if (events[1]) {
				try {
					UserFlux.ufTrackQueue = JSON.parse(events[1])
				} catch (e) {
					UserFlux.ufTrackQueue = []
				}
			}
		} catch (error) {
			console.info("Error loading stored data: ", error)
		}
	}

	static updateDefaultTrackingProperties(properties) {
		if (typeof properties !== "object") {
			console.info("UF defaultTrackingProperties must be an object.")
			return
		}
		UserFlux.ufDefaultTrackingProperties = properties
	}

	static setupSessionId() {
		try {
			const newSessionId = UserFlux.generateUUID()
			UserFlux.ufSessionId = newSessionId
			UserFlux.ufSessionStartTime = Date.now()
			UserFlux.ufLastActivityTime = Date.now()
		} catch (error) {
			console.info("Error setting up session ID: ", error)
		}
	}

	static getSessionId() {
		// Check if session has expired
		const timeSinceLastActivity = Date.now() - UserFlux.ufLastActivityTime
		if (timeSinceLastActivity > UserFlux.ufSessionTimeout) {
			UserFlux.setupSessionId()
		}
		UserFlux.ufLastActivityTime = Date.now()
		return UserFlux.ufSessionId
	}

	static setupAutoTracking(autoCaptureOptions) {
		if (!Array.isArray(autoCaptureOptions)) {
			console.info("UF autoCapture must be an array.")
			return
		}

		if (autoCaptureOptions.includes("screen_views") || autoCaptureOptions.includes("all")) {
			// Screen view tracking requires integration with navigation
			console.info("Screen view tracking enabled. Call UserFlux.trackScreenView(screenName) when screens change.")
		}

		if (autoCaptureOptions.includes("app_opens") || autoCaptureOptions.includes("all")) {
			UserFlux.trackAppOpen()
		}
	}

	static async trackScreenView(screenName, properties = {}) {
		const screenViewProperties = {
			screenName: screenName,
			previousScreen: UserFlux.ufCurrentScreen,
			...properties
		}

		// Track time spent on previous screen
		if (UserFlux.ufCurrentScreen && UserFlux.ufScreenStartTime) {
			const timeOnScreen = Math.round((Date.now() - UserFlux.ufScreenStartTime) / 1000)
			screenViewProperties.previousScreenTime = timeOnScreen
		}

		UserFlux.ufCurrentScreen = screenName
		UserFlux.ufScreenStartTime = Date.now()

		await UserFlux.track({
			event: "screen_view",
			properties: screenViewProperties,
			addToQueue: false
		})
	}

	static async trackAppOpen() {
		const deepLink = await Linking.getInitialURL()
		
		await UserFlux.track({
			event: "app_open",
			properties: {
				deepLink: deepLink,
				...UserFlux.getDeviceProperties()
			},
			addToQueue: false
		})
	}

	static async trackAppBackground() {
		await UserFlux.track({
			event: "app_background",
			properties: {
				sessionDuration: UserFlux.ufSessionStartTime ? 
					Math.round((Date.now() - UserFlux.ufSessionStartTime) / 1000) : null
			},
			addToQueue: true
		})
	}

	static isApiKeyProvided() {
		return UserFlux.ufApiKey !== null
	}

	static getOrCreateAnonymousId() {
		let anonymousId
		if (UserFlux.isStringNullOrBlank(UserFlux.ufAnonymousId)) {
			anonymousId = UserFlux.createNewAnonymousId()
		} else {
			anonymousId = UserFlux.ufAnonymousId
		}

		UserFlux.ufAnonymousId = anonymousId
		AsyncStorage.setItem("uf-anonymousId", anonymousId)

		return anonymousId
	}

	static createNewAnonymousId() {
		return UserFlux.generateUUID()
	}

	static generateUUID() {
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
			let r = (Math.random() * 16) | 0,
				v = c == 'x' ? r : (r & 0x3) | 0x8
			return v.toString(16)
		})
	}

	static getUserId() {
		return UserFlux.ufUserId
	}

	static getAnonymousId() {
		return UserFlux.getOrCreateAnonymousId()
	}

	static setUserId(userId) {
		UserFlux.ufUserId = userId
		if (!UserFlux.ufDisableUserIdStorage) {
			AsyncStorage.setItem("uf-userId", userId || "")
		}
	}

	static setExternalId(externalId) {
		UserFlux.ufExternalId = externalId
		AsyncStorage.setItem("uf-externalId", externalId || "")
	}

	static async loadEventsFromStorage() {
		try {
			const events = await AsyncStorage.getItem("uf-track")
			UserFlux.ufTrackQueue = events ? JSON.parse(events) : []
		} catch (error) {
			console.info("Failed to get tracking events from storage: ", error)
			await AsyncStorage.removeItem("uf-track")
			UserFlux.ufTrackQueue = []
		}
	}

	static async reset() {
		// Flush any pending events
		await UserFlux.checkQueue(UserFlux.ufTrackQueue, "event/ingest/batch", true)

		// Clear all stored data
		UserFlux.ufUserId = null
		UserFlux.ufAnonymousId = null
		UserFlux.ufExternalId = null
		UserFlux.ufSessionId = null

		await AsyncStorage.multiRemove([
			"uf-userId",
			"uf-anonymousId",
			"uf-externalId",
			"uf-track"
		])

		// Create new anonymous ID
		UserFlux.ufAnonymousId = UserFlux.createNewAnonymousId()
		await AsyncStorage.setItem("uf-anonymousId", UserFlux.ufAnonymousId)

		// Create new session
		UserFlux.setupSessionId()
	}

	static startFlushInterval() {
		UserFlux.ufFlushInterval = setInterval(async () => {
			await UserFlux.checkQueue(UserFlux.ufTrackQueue, "event/ingest/batch", true)
		}, 1500)
	}

	static async identify(parameters) {
		if (!UserFlux.isApiKeyProvided()) {
			console.info("API key not provided. Cannot identify user.")
			return
		}

		if (!parameters || typeof parameters !== "object") {
			console.info("Invalid parameters passed to identify method")
			return
		}

		let userId = parameters.userId || UserFlux.ufUserId
		if (userId && (typeof userId !== "string" || UserFlux.isStringNullOrBlank(userId))) userId = null
		if (userId !== UserFlux.ufUserId) UserFlux.setUserId(userId)

		let externalId = parameters.externalId || UserFlux.ufExternalId
		if (externalId && (typeof externalId !== "string" || UserFlux.isStringNullOrBlank(externalId))) externalId = null
		if (externalId !== UserFlux.ufExternalId) UserFlux.setExternalId(externalId)

		const properties = parameters.properties || {}
		if (typeof properties !== "object") {
			console.info("Invalid properties passed to identify method")
			return
		}

		const enrichDeviceData = parameters.enrichDeviceData !== false && UserFlux.ufDeviceDataEnrichmentEnabled
		const enrichLocationData = parameters.enrichLocationData !== false && UserFlux.ufLocationEnrichmentEnabled

		const payload = {
			userId: userId,
			externalId: externalId,
			anonymousId: UserFlux.getOrCreateAnonymousId(),
			properties: properties,
			deviceData: enrichDeviceData ? await UserFlux.getDeviceProperties() : null
		}

		return await UserFlux.sendRequest("profile", payload, enrichLocationData)
	}

	static async track(parameters) {
		if (!UserFlux.isApiKeyProvided()) {
			console.info("API key not provided. Cannot track event.")
			return
		}

		if (!parameters || typeof parameters !== "object") {
			console.info("Invalid parameters passed to track method")
			return
		}

		const event = parameters.event
		if (!event || typeof event !== "string" || UserFlux.isStringNullOrBlank(event)) {
			console.info("Invalid event passed to track method")
			return
		}

		let userId = parameters.userId || UserFlux.ufUserId
		if (userId && (typeof userId !== "string" || UserFlux.isStringNullOrBlank(userId))) userId = null
		if (userId !== UserFlux.ufUserId) UserFlux.setUserId(userId)

		let externalId = parameters.externalId || UserFlux.ufExternalId
		if (externalId && (typeof externalId !== "string" || UserFlux.isStringNullOrBlank(externalId))) externalId = null
		if (externalId !== UserFlux.ufExternalId) UserFlux.setExternalId(externalId)

		const properties = parameters.properties || {}
		const enrichDeviceData = parameters.enrichDeviceData !== false && UserFlux.ufDeviceDataEnrichmentEnabled
		const enrichLocationData = parameters.enrichLocationData !== false && UserFlux.ufLocationEnrichmentEnabled
		const addToQueue = parameters.addToQueue || false

		const finalProperties = {
			...properties,
			...UserFlux.ufDefaultTrackingProperties
		}

		const payload = {
			timestamp: Date.now(),
			userId: userId,
			anonymousId: UserFlux.getOrCreateAnonymousId(),
			externalId: externalId,
			sessionId: UserFlux.getSessionId(),
			name: event,
			properties: finalProperties,
			deviceData: enrichDeviceData ? await UserFlux.getDeviceProperties() : null
		}

		UserFlux.ufTrackQueue.push(payload)
		await UserFlux.saveEventsToStorage("uf-track", UserFlux.ufTrackQueue)
		await UserFlux.checkQueue(UserFlux.ufTrackQueue, "event/ingest/batch", !addToQueue)
		return null
	}

	static async trackBatch(events) {
		for (const event of events) {
			await UserFlux.track({ ...event, addToQueue: true })
		}
		await UserFlux.flush()
	}

	static async flush() {
		await UserFlux.checkQueue(UserFlux.ufTrackQueue, "event/ingest/batch", true)
	}

	static async saveEventsToStorage(key, queue) {
		try {
			await AsyncStorage.setItem(key, JSON.stringify(queue))
		} catch (error) {
			console.info("Error saving events to storage: ", error)
		}
	}

	static async checkQueue(queue, eventType, forceFlush) {
		if (queue.length >= 10 || (forceFlush && queue.length > 0)) {
			await UserFlux.flushEvents(queue, eventType)
		}
	}

	static async flushEvents(queue, eventType) {
		if (!UserFlux.isApiKeyProvided()) {
			console.info("API key not provided. Cannot flush events.")
			return
		}

		// Check network connectivity
		const netInfo = await NetInfo.fetch()
		if (!netInfo.isConnected) {
			console.info("No network connection. Events will be flushed when connection is restored.")
			return
		}

		if (UserFlux.ufConsecutiveFailures >= UserFlux.ufMaxConsecutiveFailures) {
			console.info(`UF: Max consecutive failures (${UserFlux.ufMaxConsecutiveFailures}) reached. Stopping flush attempts.`)
			setTimeout(() => {
				UserFlux.ufConsecutiveFailures = 0
			}, 60000)
			return
		}

		const eventsToTrack = queue.splice(0, 10)
		const success = await UserFlux.sendRequest(eventType, { events: eventsToTrack })
		if (success) {
			await UserFlux.saveEventsToStorage("uf-track", queue)
			UserFlux.ufConsecutiveFailures = 0
		} else {
			queue.push(...eventsToTrack)
			await UserFlux.saveEventsToStorage("uf-track", queue)
			UserFlux.ufConsecutiveFailures++
		}

		if (queue.length > 0) {
			setTimeout(async () => {
				await UserFlux.checkQueue(queue, eventType, true)
			}, UserFlux.ufRetryDelay)
		}
	}

	static async sendRequest(endpoint, data, locationEnrich = UserFlux.ufLocationEnrichmentEnabled) {
		if (!UserFlux.isApiKeyProvided()) {
			console.info("API key not provided. Cannot send request.")
			return false
		}

		try {
			const response = await fetch(`https://integration-api.userflux.co/${endpoint}?locationEnrichment=${locationEnrich}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${UserFlux.ufApiKey}`
				},
				body: JSON.stringify(data)
			})

			return response.ok
		} catch (error) {
			console.info("UF HTTP Error: ", error)
			return false
		}
	}

	static async getDeviceProperties() {
		try {
			const deviceProperties = {
				platform: Platform.OS,
				platformVersion: Platform.Version,
				deviceType: DeviceInfo.getDeviceType(),
				deviceModel: DeviceInfo.getModel(),
				deviceBrand: await DeviceInfo.getBrand(),
				deviceManufacturer: await DeviceInfo.getManufacturer(),
				deviceId: await DeviceInfo.getDeviceId(),
				systemName: await DeviceInfo.getSystemName(),
				systemVersion: await DeviceInfo.getSystemVersion(),
				appVersion: DeviceInfo.getVersion(),
				appBuildNumber: DeviceInfo.getBuildNumber(),
				bundleId: DeviceInfo.getBundleId(),
				isTablet: DeviceInfo.isTablet(),
				hasNotch: DeviceInfo.hasNotch(),
				screenWidth: Dimensions.get('window').width,
				screenHeight: Dimensions.get('window').height,
				screenScale: Dimensions.get('window').scale,
				timezone: await DeviceInfo.getTimezone(),
				locale: await DeviceInfo.getLocale(),
				country: await DeviceInfo.getCountry(),
				uniqueId: await DeviceInfo.getUniqueId(),
				carrier: await DeviceInfo.getCarrier(),
				totalMemory: await DeviceInfo.getTotalMemory(),
				totalDiskCapacity: await DeviceInfo.getTotalDiskCapacity(),
				isEmulator: await DeviceInfo.isEmulator()
			}

			return UserFlux.removeNullProperties(deviceProperties)
		} catch (error) {
			console.info("Error getting device properties:", error)
			return {
				platform: Platform.OS,
				platformVersion: Platform.Version,
				screenWidth: Dimensions.get('window').width,
				screenHeight: Dimensions.get('window').height
			}
		}
	}

	static async isEmulatorOrSimulator() {
		try {
			return await DeviceInfo.isEmulator()
		} catch (error) {
			return false
		}
	}

	static isStringNullOrBlank(value) {
		if (typeof value !== "string") return true
		return !value || value == null || value == undefined || value == "" || value == "null" || value == "undefined"
	}

	static removeNullProperties(object) {
		return Object.fromEntries(Object.entries(object).filter(([key, value]) => value !== null && value !== undefined))
	}
}

export default UserFlux