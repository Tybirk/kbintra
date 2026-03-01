import { NumberInput, SegmentedControl, Group, Text, Divider } from "@mantine/core"
import { useState } from "react"
import type { DiningOption, SeatingTime } from "../types"

interface MealFormFieldsProps {
  adults: number
  children: number
  mealType: "meat" | "vegetarian"
  diningOption: DiningOption
  seatingTime: SeatingTime
  isWednesday: boolean
  disabled?: boolean
  onAdultsChange: (val: number) => void
  onChildrenChange: (val: number) => void
  onMealTypeChange: (val: "meat" | "vegetarian") => void
  onDiningOptionChange: (val: DiningOption) => void
  onSeatingTimeChange: (val: SeatingTime) => void
}

export function MealFormFields({
  adults,
  children,
  mealType,
  diningOption,
  seatingTime,
  isWednesday,
  disabled,
  onAdultsChange,
  onChildrenChange,
  onMealTypeChange,
  onDiningOptionChange,
  onSeatingTimeChange,
}: MealFormFieldsProps) {
  // Display state: allows empty string while user is editing
  const [adultsInput, setAdultsInput] = useState<number | string>(adults)
  const [childrenInput, setChildrenInput] = useState<number | string>(children)

  return (
    <>
      <Group grow>
        <NumberInput
          label="Voksne"
          value={adultsInput}
          onChange={setAdultsInput}
          onBlur={() => {
            const val = adultsInput === "" ? 0 : Number(adultsInput)
            setAdultsInput(val)
            onAdultsChange(val)
          }}
          min={0}
          max={10}
          disabled={disabled}
        />
        <NumberInput
          label="Børn"
          value={childrenInput}
          onChange={setChildrenInput}
          onBlur={() => {
            const val = childrenInput === "" ? 0 : Number(childrenInput)
            setChildrenInput(val)
            onChildrenChange(val)
          }}
          min={0}
          max={10}
          disabled={disabled}
        />
      </Group>

      {isWednesday && (
        <div>
          <Text size="sm" fw={500} mb={4}>
            Måltidstype
          </Text>
          <SegmentedControl
            value={mealType}
            onChange={(val) => onMealTypeChange(val as "meat" | "vegetarian")}
            data={[
              { label: "Kød", value: "meat" },
              { label: "Vegetar", value: "vegetarian" },
            ]}
            fullWidth
            disabled={disabled}
          />
        </div>
      )}

      <Divider />

      <div>
        <Text size="sm" fw={500} mb={4}>
          Spisested
        </Text>
        <SegmentedControl
          value={diningOption}
          onChange={(val) => onDiningOptionChange(val as DiningOption)}
          data={[
            { label: "Spise i fælleshuset", value: "eat_in" },
            { label: "Tag med", value: "take_away" },
          ]}
          fullWidth
          disabled={disabled}
        />
      </div>

      {diningOption === "eat_in" && (
        <div>
          <Text size="sm" fw={500} mb={4}>
            Spisetid
          </Text>
          <SegmentedControl
            value={seatingTime}
            onChange={(val) => onSeatingTimeChange(val as SeatingTime)}
            data={[
              { label: "17:30", value: "17:30" },
              { label: "18:30", value: "18:30" },
            ]}
            fullWidth
            disabled={disabled}
          />
        </div>
      )}
    </>
  )
}
