import { useRoute, type RouteProp } from '@react-navigation/native';

import { ChatConversation } from '../components/chat/ChatConversation';
import { useSafeBack } from '../hooks/useSafeBack';
import type { RootStackParamList } from '../navigation/types';

type ChatScreenRouteProp = RouteProp<RootStackParamList, 'ChatScreen'>;

export default function ChatScreen() {
  const safeBack = useSafeBack();
  const { threadId } = useRoute<ChatScreenRouteProp>().params;
  return <ChatConversation threadId={threadId} onBack={safeBack} />;
}
