import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Dimensions, Pressable, LayoutChangeEvent } from 'react-native';
import { Canvas, Skia, Path } from '@shopify/react-native-skia';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';

import { useNotes } from '../contexts/NoteContext';
import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import { useViewMode } from '../contexts/ViewModeContext';
import { useAIStore } from '../stores/aiStore';
import { Note } from '../models/Note';
import { buildBacklinkIndex } from '../services/BacklinksService';
import { computeForceLayout } from '../utils/forceLayout';
import { parseWikiLinks } from '../utils/wikiLinksParser';
import { RootStackParamList } from '../navigation/types';
import { ScreenHeader } from '../components/ui';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import SearchBar from '../components/SearchBar';
import { readableInk } from '../theme/tokens';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface GraphNode {
  id: string;
  note: Note;
  x: number;
  y: number;
  connections: Set<string>;
}

interface GraphEdge {
  from: string;
  to: string;
  isBlockLevel?: boolean;
}

const NODE_SIZE = 72;
const CANVAS_SIZE = 2000;
const BASE_SCALE = 1.0;
const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;

export default function GraphViewScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const { colors } = useTheme();
  const { notes } = useNotes();
  const { setViewMode } = useViewMode();
  const setChatRepo = useAIStore((s) => s.setChatRepo);
  const { width: screenWidth } = Dimensions.get('window');

  const canvasWidth = CANVAS_SIZE;
  const canvasHeight = CANVAS_SIZE;

  const scale = useSharedValue(BASE_SCALE);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedScale = useSharedValue(BASE_SCALE);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const containerHeightRef = useRef(0);
  const draggingNodeId = useSharedValue<string | null>(null);
  const localNodesRef = useRef<GraphNode[]>([]);
  const [localNodes, setLocalNodes] = useState<GraphNode[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const CONTENT_PREVIEW_LENGTH = 120;
  const EXPANDED_LENGTH = 300;

  const { nodes, edges } = useMemo(() => {
    if (!notes.length) {
      return { nodes: [], edges: [] };
    }

    const nodeMap = new Map<string, GraphNode>();
    const graphEdges: GraphEdge[] = [];

    notes.forEach((note, index) => {
      const angle = (index / notes.length) * 2 * Math.PI;
      const radius = Math.min(canvasWidth, canvasHeight) / 4;
      nodeMap.set(note.id, {
        id: note.id,
        note,
        x: canvasWidth / 2 + Math.cos(angle) * radius,
        y: canvasHeight / 2 + Math.sin(angle) * radius,
        connections: new Set(),
      });
    });

    notes.forEach((note) => {
      const links = parseWikiLinks(note.content);
      links.forEach((link) => {
        const targetNote = notes.find(
          (n) =>
            n.title.toLowerCase() === link.target.toLowerCase() ||
            n.filePath?.toLowerCase().includes(link.target.toLowerCase())
        );
        if (targetNote && targetNote.id !== note.id) {
          graphEdges.push({ from: note.id, to: targetNote.id });
          nodeMap.get(note.id)?.connections.add(targetNote.id);
          nodeMap.get(targetNote.id)?.connections.add(note.id);
        }
      });
    });

    const backlinkIndex = buildBacklinkIndex(notes);
    notes.forEach((note) => {
      const backlinks = backlinkIndex.get(note.id) || [];
      backlinks.forEach((bl) => {
        if (bl.sourceNoteId !== note.id) {
          graphEdges.push({ from: bl.sourceNoteId, to: note.id, isBlockLevel: !!bl.blockAnchor });
          nodeMap.get(bl.sourceNoteId)?.connections.add(note.id);
          nodeMap.get(note.id)?.connections.add(bl.sourceNoteId);
        }
      });
    });

    return {
      nodes: Array.from(nodeMap.values()),
      edges: graphEdges,
    };
  }, [notes, canvasWidth, canvasHeight]);

  const layoutNodes = useMemo(
    () => computeForceLayout(nodes, edges, canvasWidth, canvasHeight),
    [nodes, edges, canvasWidth, canvasHeight],
  );

  const centerGraph = useCallback(() => {
    const nodesToCenter = localNodesRef.current;
    if (nodesToCenter.length === 0 || containerHeightRef.current === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodesToCenter.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    });

    const padding = NODE_SIZE;
    const contentWidth = maxX - minX + padding * 2;
    const contentHeight = maxY - minY + padding * 2;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const availableWidth = screenWidth;
    const availableHeight = containerHeightRef.current;
    const fitScaleX = availableWidth / contentWidth;
    const fitScaleY = availableHeight / contentHeight;
    const fitScale = Math.min(fitScaleX, fitScaleY, MAX_SCALE);

    const clampedScale = Math.max(MIN_SCALE, Math.min(fitScale, MAX_SCALE));
    scale.value = clampedScale;
    translateX.value = screenWidth / 2 - centerX * clampedScale;
    translateY.value = containerHeightRef.current * 0.4 - centerY * clampedScale;
    savedScale.value = clampedScale;
    savedTranslateX.value = screenWidth / 2 - centerX * clampedScale;
    savedTranslateY.value = containerHeightRef.current * 0.4 - centerY * clampedScale;
  }, [screenWidth, scale, savedScale, translateX, translateY, savedTranslateX, savedTranslateY]);

  useEffect(() => {
    if (layoutNodes.length > 0) {
      localNodesRef.current = layoutNodes;
      setLocalNodes(layoutNodes);
      if (containerHeightRef.current > 0) {
        centerGraph();
      }
    }
  }, [layoutNodes, centerGraph]);

  useEffect(() => {
    if (containerHeight > 0 && localNodesRef.current.length > 0) {
      centerGraph();
    }
  }, [containerHeight, centerGraph]);

  const handleContainerLayout = (e: LayoutChangeEvent) => {
    const newHeight = e.nativeEvent.layout.height;
    containerHeightRef.current = newHeight;
    setContainerHeight(newHeight);
    if (localNodesRef.current.length > 0 && newHeight > 0) {
      centerGraph();
    }
  };

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return localNodes.find((n) => n.id === selectedNodeId) || null;
  }, [selectedNodeId, localNodes]);

  const isNodeHighlighted = useCallback((node: GraphNode): boolean => {
    if (searchQuery) {
      return node.note.title.toLowerCase().includes(searchQuery.toLowerCase());
    }
    if (!selectedNodeId) return false;
    return node.id === selectedNodeId || node.connections.has(selectedNodeId);
  }, [selectedNodeId, searchQuery]);

  const getNodeAlpha = useCallback((node: GraphNode): number => {
    if (!selectedNodeId && !searchQuery) return 1.0;
    if (searchQuery) {
      return isNodeHighlighted(node) ? 1.0 : 0.2;
    }
    return isNodeHighlighted(node) ? 1.0 : 0.3;
  }, [selectedNodeId, searchQuery, isNodeHighlighted]);

  const handleNodePress = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleNodeLongPress = useCallback((node: GraphNode) => {
    if (node.note.repo && node.note.branch) {
      setChatRepo(node.note.repo, node.note.branch.split('/')[0], node.note.branch);
    }
    setSelectedNodeId(node.id);
  }, [setChatRepo]);

  const handleOpenNote = useCallback(() => {
    if (selectedNode) {
      setViewMode('list');
      navigation.navigate('NoteEditor', { noteId: selectedNode.note.id });
    }
  }, [selectedNode, navigation, setViewMode]);

  const handleCloseScreen = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleNodeDragStart = useCallback((nodeId: string) => {
    draggingNodeId.value = nodeId;
  }, [draggingNodeId]);

  const handleNodeDrag = useCallback((nodeId: string, dx: number, dy: number) => {
    setLocalNodes((prev) =>
      prev.map((n) => {
        if (n.id === nodeId) {
          const newX = Math.max(NODE_SIZE / 2 + 40, Math.min(canvasWidth - NODE_SIZE / 2 - 40, n.x + dx / scale.value));
          const newY = Math.max(NODE_SIZE / 2 + 40, Math.min(canvasHeight - NODE_SIZE / 2 - 40, n.y + dy / scale.value));
          return { ...n, x: newX, y: newY };
        }
        return n;
      })
    );
  }, [scale, canvasWidth, canvasHeight]);

  const handleNodeDragEnd = useCallback(() => {
    draggingNodeId.value = null;
  }, [draggingNodeId]);

  const toggleNodeExpanded = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const getNodeDimensions = useCallback((node: GraphNode, isExpanded: boolean) => {
    const content = node.note.content;
    const isLong = content.length > CONTENT_PREVIEW_LENGTH;
    const displayContent = isExpanded || !isLong
      ? content.slice(0, EXPANDED_LENGTH)
      : content.slice(0, CONTENT_PREVIEW_LENGTH);

    // Calculate approximate size based on content length
    const baseWidth = 100;
    const charWidth = 7;
    const lineHeight = 18;

    const maxWidth = isExpanded ? 280 : baseWidth;
    const charsPerLine = Math.floor(maxWidth / charWidth);
    const lines = Math.ceil(displayContent.length / charsPerLine);
    const textHeight = Math.min(lines * lineHeight, isExpanded ? 200 : 80);

    const width = Math.min(maxWidth, displayContent.length * charWidth + 24);
    const height = textHeight + 40; // padding for title and expand indicator

    return {
      width: Math.max(100, Math.min(width, 300)),
      height: Math.max(60, Math.min(height, 240)),
      isLong,
      displayContent,
    };
  }, []);

  const getNodeColor = useCallback(
    (node: GraphNode) => {
      if (node.note.color) {
        switch (node.note.color) {
          case 'red': return '#ef4444';
          case 'orange': return '#f97316';
          case 'yellow': return '#eab308';
          case 'green': return '#22c55e';
          case 'blue': return '#3b82f6';
          case 'purple': return '#a855f7';
          case 'pink': return '#ec4899';
          case 'gray': return '#6b7280';
        }
      }
      return colors.primary;
    },
    [colors]
  );

  const { pageEdgePath, blockEdgePath } = useMemo(() => {
    const pagePathBuilder = Skia.PathBuilder.Make();
    const blockPathBuilder = Skia.PathBuilder.Make();
    const nodeById = new Map(localNodes.map((n) => [n.id, n]));
    edges.forEach((edge) => {
      const source = nodeById.get(edge.from);
      const target = nodeById.get(edge.to);
      if (source && target) {
        if (edge.isBlockLevel) {
          blockPathBuilder.moveTo(source.x, source.y);
          blockPathBuilder.lineTo(target.x, target.y);
        } else {
          pagePathBuilder.moveTo(source.x, source.y);
          pagePathBuilder.lineTo(target.x, target.y);
        }
      }
    });
    return { pageEdgePath: pagePathBuilder.build(), blockEdgePath: blockPathBuilder.build() };
  }, [edges, localNodes]);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      const nodeId = draggingNodeId.value;
      if (nodeId) {
        runOnJS(handleNodeDrag)(nodeId, e.translationX, e.translationY);
      } else {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd(() => {
      if (draggingNodeId.value) {
        runOnJS(handleNodeDragEnd)();
      } else {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      }
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <SafeAreaView edges={[]} className="flex-1" style={{ backgroundColor: colors.background }}>
      <ScreenHeader
        title={t('notes.graphView')}
        onBack={handleCloseScreen}
      />

      {notes.length > 0 && (
        <View className="px-4 py-2" style={{ backgroundColor: colors.surface }}>
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('notes.searchGraph')}
          />
        </View>
      )}

      <View className="flex-1" onLayout={handleContainerLayout}>
        {notes.length === 0 ? (
          <View className="flex-1 items-center justify-center p-8">
            <Ionicons name="git-network-outline" size={64} color={colors.textSecondary} />
            <Text className="text-lg font-semibold mt-4" style={{ color: colors.textSecondary }}>
              {t('notes.noNotesToDisplay')}
            </Text>
            <Text className="text-sm text-center mt-2" style={{ color: colors.textSecondary }}>
              {t('notes.createWithWikiLinksGraph')}
            </Text>
          </View>
        ) : (
          <GestureDetector gesture={composedGesture}>
            <Animated.View className="flex-1" style={animatedStyle}>
              <View style={{ width: canvasWidth, height: canvasHeight }}>
                <Canvas style={{ width: canvasWidth, height: canvasHeight }}>
                  <Path
                    path={pageEdgePath}
                    color={colors.border}
                    style="stroke"
                    strokeWidth={selectedNodeId ? 2.5 : 1.5}
                    opacity={0.4}
                  />
                  <Path
                    path={blockEdgePath}
                    color={colors.border}
                    style="stroke"
                    strokeWidth={0.75}
                    opacity={0.2}
                  />
                </Canvas>

                {localNodes.map((node) => {
                  const isHighlighted = isNodeHighlighted(node);
                  const nodeAlpha = getNodeAlpha(node);
                  const isExpanded = expandedNodes.has(node.id);
                  const dims = getNodeDimensions(node, isExpanded);
                  return (
                    <Pressable
                      key={node.id}
                      onPress={() => handleNodePress(node.id)}
                      onLongPress={() => handleNodeLongPress(node)}
                      onPressIn={() => handleNodeDragStart(node.id)}
                      style={{
                        position: 'absolute',
                        left: node.x - dims.width / 2,
                        top: node.y - dims.height / 2,
                        width: dims.width,
                        height: dims.height,
                        opacity: nodeAlpha,
                        borderRadius: 12,
                        borderWidth: 2,
                        padding: 10,
                        borderColor: isHighlighted ? colors.primary : getNodeColor(node),
                        backgroundColor: colors.surface,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.25,
                        shadowRadius: 4,
                        elevation: 5,
                      }}
                    >
                      <Text className="text-[13px] font-bold mb-1" style={{ color: colors.text }} numberOfLines={1}>
                        {node.note.title}
                      </Text>
                      <Text className="text-[11px] leading-[15px] flex-1" style={{ color: colors.textSecondary }} numberOfLines={isExpanded ? 10 : 3}>
                        {dims.displayContent}
                      </Text>
                      {dims.isLong && (
                        <TouchableOpacity
                          className="self-end px-2 py-1 rounded-lg mt-1"
                          style={{ backgroundColor: getNodeColor(node) }}
                          onPress={() => toggleNodeExpanded(node.id)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text className="text-[11px] font-bold" style={{ color: readableInk(getNodeColor(node)) }}>
                            {isExpanded ? '▲' : '▼'}
                          </Text>
                        </TouchableOpacity>
                      )}
                      <View
                        className="absolute -top-2 -right-2 min-w-[20px] h-5 rounded-full items-center justify-center px-1 border-2"
                        style={{
                          backgroundColor: colors.surface,
                          shadowColor: '#000',
                          shadowOffset: { width: 0, height: 1 },
                          shadowOpacity: 0.2,
                          shadowRadius: 2,
                          elevation: 3,
                        }}
                      >
                        <Text className="text-[10px] font-bold" style={{ color: colors.text }}>
                          {node.connections.size}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </Animated.View>
          </GestureDetector>
        )}

        {selectedNode && (
          <View
            className="absolute bottom-2 left-4 right-4 p-4 rounded-2xl border"
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 8,
              elevation: 5,
            }}
          >
            <View className="flex-row items-center gap-2.5">
              <View className="w-3 h-3 rounded-full" style={{ backgroundColor: getNodeColor(selectedNode) }} />
              <Text className="text-[17px] font-bold flex-1" style={{ color: colors.text }} numberOfLines={1}>
                {selectedNode.note.title}
              </Text>
            </View>
            <Text className="text-[13px] mt-1.5 ml-[22px]" style={{ color: colors.textSecondary }}>
              {selectedNode.connections.size} connection{selectedNode.connections.size !== 1 ? 's' : ''}
            </Text>
            <View className="flex-row gap-2.5 mt-3.5">
              <TouchableOpacity
                className="flex-1 py-3 px-5 rounded-[10px] items-center"
                style={{ backgroundColor: colors.primary }}
                onPress={handleOpenNote}
              >
                <Text className="font-bold text-[15px]" style={{ color: readableInk(colors.primary) }}>Open Note</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <View className="flex-row items-center justify-center py-2 px-4 gap-3" style={{ backgroundColor: colors.surface }}>
        <View className="flex-row items-center gap-1.5">
          <View className="w-2.5 h-2.5 rounded-[5px]" style={{ backgroundColor: colors.primary }} />
          <Text className="text-xs" style={{ color: colors.textSecondary }}>Notes</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <View className="w-5 h-0.5" style={{ backgroundColor: colors.border }} />
          <Text className="text-xs" style={{ color: colors.textSecondary }}>Links</Text>
        </View>
        <Text className="text-[11px]" style={{ color: colors.textSecondary }}>·</Text>
        <Text className="text-[11px]" style={{ color: colors.textSecondary }}>
          Drag nodes to move them
        </Text>
      </View>
    </SafeAreaView>
  );
}
