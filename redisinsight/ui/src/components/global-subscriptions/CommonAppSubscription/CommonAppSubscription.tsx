import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Socket } from 'socket.io-client'

import { remove } from 'lodash'
import { CloudJobEvents, FeatureFlags, SocketEvent, SocketFeaturesEvent } from 'uiSrc/constants'
import { NotificationEvent } from 'uiSrc/constants/notifications'
import { setNewNotificationAction } from 'uiSrc/slices/app/notifications'
import { setIsConnected } from 'uiSrc/slices/app/socket-connection'
import { getBaseApiUrl, Nullable } from 'uiSrc/utils'
import { connectedInstanceSelector } from 'uiSrc/slices/instances/instances'
import { addUnreadRecommendations } from 'uiSrc/slices/recommendations/recommendations'
import { RecommendationsSocketEvents } from 'uiSrc/constants/recommendations'
import { appFeatureFlagsFeaturesSelector, getFeatureFlagsSuccess } from 'uiSrc/slices/app/features'
import { oauthCloudJobSelector, setJob } from 'uiSrc/slices/oauth/cloud'
import { CloudJobName } from 'uiSrc/electron/constants'
import { appCsrfSelector } from 'uiSrc/slices/app/csrf'
import { wsService } from 'uiSrc/services/wsService'
import { CloudJobInfo } from 'apiSrc/modules/cloud/job/models'

const CommonAppSubscription = () => {
  const { id: jobId = '' } = useSelector(oauthCloudJobSelector) ?? {}
  const { id: instanceId } = useSelector(connectedInstanceSelector)
  const { token } = useSelector(appCsrfSelector)
  const [recommendationsSubscriptions, setRecommendationsSubscriptions] = useState<string[]>([])
  const socketRef = useRef<Nullable<Socket>>(null)
  const { [FeatureFlags.envDependent]: envDependent } = useSelector(appFeatureFlagsFeaturesSelector)

  const dispatch = useDispatch()

  useEffect(() => {
    if (socketRef.current?.connected) {
      return
    }

    socketRef.current = wsService(`${getBaseApiUrl()}`, {
      forceNew: false,
      token,
      reconnection: true,
    }, envDependent?.flag)

    socketRef.current.on(SocketEvent.Connect, () => {
      dispatch(setIsConnected(true))
    })

    socketRef.current.on(NotificationEvent.Notification, (data) => {
      dispatch(setNewNotificationAction(data))
    })

    socketRef.current.on(SocketFeaturesEvent.Features, (data) => {
      dispatch(getFeatureFlagsSuccess(data))

      // or
      // dispatch(fetchFeatureFlags())
    })

    socketRef.current.on(CloudJobEvents.Monitor, (data: CloudJobInfo) => {
      const jobName = data.name as unknown

      if (
        jobName === CloudJobName.CreateFreeDatabase
        || jobName === CloudJobName.CreateFreeSubscriptionAndDatabase
        || jobName === CloudJobName.ImportFreeDatabase) {
        dispatch(setJob(data))
      }
    })

    // Catch disconnect
    socketRef.current?.on(SocketEvent.Disconnect, () => {
      unSubscribeFromAllRecommendations()
    })

    emitCloudJobMonitor(jobId)
  }, [])

  useEffect(() => {
    emitCloudJobMonitor(jobId)
  }, [jobId])

  useEffect(() => {
    if (!instanceId) return

    unSubscribeFromAllRecommendations()
    setRecommendationsSubscriptions((ids) => [...ids, instanceId])

    socketRef.current?.on(`${RecommendationsSocketEvents.Recommendation}:${instanceId}`, (data) => {
      dispatch(addUnreadRecommendations(data))
    })
  }, [instanceId])

  const unSubscribeFromAllRecommendations = () => {
    recommendationsSubscriptions.forEach((id) => {
      const subscription = `${RecommendationsSocketEvents.Recommendation}:${id}`
      const isListenerExist = !!socketRef.current?.listeners(subscription).length

      if (isListenerExist) {
        setRecommendationsSubscriptions((ids) => remove(ids, id))
        socketRef.current?.removeListener(subscription)
      }
    })
  }

  const emitCloudJobMonitor = (jobId: string) => {
    if (!jobId) return

    socketRef.current?.emit(
      CloudJobEvents.Monitor,
      { jobId },
    )
  }

  return null
}

export default CommonAppSubscription
