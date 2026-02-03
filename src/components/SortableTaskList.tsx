import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Task {
  id: string;
  title: string;
  // Add other fields as needed
}

interface SortableTaskItemProps {
  task: Task;
  children: React.ReactNode;
}

function SortableTaskItem({ task, children }: SortableTaskItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} data-id={task.id}>
      <span 
        {...attributes} 
        {...listeners}
        className="drag-handle"
        style={{ cursor: 'grab', padding: '4px 8px', color: 'var(--muted-foreground)' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="5" r="1"/>
          <circle cx="9" cy="12" r="1"/>
          <circle cx="9" cy="19" r="1"/>
          <circle cx="15" cy="5" r="1"/>
          <circle cx="15" cy="12" r="1"/>
          <circle cx="15" cy="19" r="1"/>
        </svg>
      </span>
      {children}
    </div>
  );
}

interface SortableTaskListProps {
  tasks: Task[];
  onReorder: (taskId: string, beforeTaskId: string | null) => void;
  renderTask: (task: Task) => React.ReactNode;
}

export function SortableTaskList({ tasks, onReorder, renderTask }: SortableTaskListProps) {
  const [items, setItems] = useState(tasks);
  
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setItems((items) => {
        const oldIndex = items.findIndex(t => t.id === active.id);
        const newIndex = items.findIndex(t => t.id === over.id);
        const newItems = arrayMove(items, oldIndex, newIndex);
        
        // Calculate beforeTaskId for the API call
        const movedTaskId = active.id as string;
        const beforeTaskId = newIndex + 1 < newItems.length ? newItems[newIndex + 1].id : null;
        
        // Call the reorder API
        onReorder(movedTaskId, beforeTaskId);
        
        return newItems;
      });
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items.map(t => t.id)} strategy={verticalListSortingStrategy}>
        {items.map((task) => (
          <SortableTaskItem key={task.id} task={task}>
            {renderTask(task)}
          </SortableTaskItem>
        ))}
      </SortableContext>
    </DndContext>
  );
}
