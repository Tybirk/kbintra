import {
  NumberInput,
  Group,
  Text,
  Divider,
  SegmentedControl,
} from "@mantine/core"
import { useState, useEffect } from "react"
import type { DiningOption, SeatingTime } from "../types"

interface MealFormFieldsProps {
  adultsMeat: number
  adultsVeg: number
  children: number
  diningOption: DiningOption
  seatingTime: SeatingTime
  isWednesday: boolean
  disabled?: boolean
  /** When true, portion inputs are hidden (show as read-only text) but dining/seating remain editable */
  portionsReadOnly?: boolean
  /** When true, dining/seating controls are disabled regardless of other props */
  diningDisabled?: boolean
  onAdultsMeatChange: (val: number) => void
  onAdultsVegChange: (val: number) => void
  onChildrenChange: (val: number) => void
  onDiningOptionChange: (val: DiningOption) => void
  onSeatingTimeChange: (val: SeatingTime) => void
}

export function MealFormFields({
  adultsMeat,
  adultsVeg,
  children,
  diningOption,
  seatingTime,
  isWednesday,
  disabled,
  portionsReadOnly,
  diningDisabled,
  onAdultsMeatChange,
  onAdultsVegChange,
  onChildrenChange,
  onDiningOptionChange,
  onSeatingTimeChange,
}: MealFormFieldsProps) {
  const [adultsMeatInput, setAdultsMeatInput] = useState<number | string>(
    adultsMeat,
  )
  const [adultsVegInput, setAdultsVegInput] = useState<number | string>(
    adultsVeg,
  )
  const [childrenInput, setChildrenInput] = useState<number | string>(children)

  useEffect(() => {
    setAdultsMeatInput(adultsMeat)
  }, [adultsMeat])
  useEffect(() => {
    setAdultsVegInput(adultsVeg)
  }, [adultsVeg])
  useEffect(() => {
    setChildrenInput(children)
  }, [children])

  return (
    <>
      {!portionsReadOnly && (
        <Group grow>
          {isWednesday ? (
            <>
              <NumberInput
                label="Voksne (kød)"
                value={adultsMeatInput}
                onChange={(val) => {
                  setAdultsMeatInput(val)
                  if (typeof val === "number") onAdultsMeatChange(val)
                }}
                onBlur={() => {
                  const val =
                    adultsMeatInput === "" ? 0 : Number(adultsMeatInput)
                  setAdultsMeatInput(val)
                  onAdultsMeatChange(val)
                }}
                min={0}
                max={19}
                clampBehavior="strict"
                allowLeadingZeros={false}
                disabled={disabled}
              />
              <NumberInput
                label="Voksne (vegetar)"
                value={adultsVegInput}
                onChange={(val) => {
                  setAdultsVegInput(val)
                  if (typeof val === "number") onAdultsVegChange(val)
                }}
                onBlur={() => {
                  const val = adultsVegInput === "" ? 0 : Number(adultsVegInput)
                  setAdultsVegInput(val)
                  onAdultsVegChange(val)
                }}
                min={0}
                max={19}
                clampBehavior="strict"
                allowLeadingZeros={false}
                disabled={disabled}
              />
            </>
          ) : (
            <NumberInput
              label="Voksne"
              value={adultsVegInput}
              onChange={(val) => {
                setAdultsVegInput(val)
                if (typeof val === "number") {
                  onAdultsVegChange(val)
                  onAdultsMeatChange(0)
                }
              }}
              onBlur={() => {
                const val = adultsVegInput === "" ? 0 : Number(adultsVegInput)
                setAdultsVegInput(val)
                onAdultsVegChange(val)
                // On non-Wednesday, meat is always 0
                onAdultsMeatChange(0)
              }}
              min={0}
              max={19}
              clampBehavior="strict"
              disabled={disabled}
            />
          )}
          <NumberInput
            label="Børn"
            value={childrenInput}
            onChange={(val) => {
              setChildrenInput(val)
              if (typeof val === "number") onChildrenChange(val)
            }}
            onBlur={() => {
              const val = childrenInput === "" ? 0 : Number(childrenInput)
              setChildrenInput(val)
              onChildrenChange(val)
            }}
            min={0}
            max={19}
            clampBehavior="strict"
            disabled={disabled}
          />
        </Group>
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
            { label: "Fælleshuset", value: "eat_in" },
            { label: "Tag med", value: "take_away" },
          ]}
          fullWidth
          disabled={(disabled && !portionsReadOnly) || diningDisabled}
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
            disabled={(disabled && !portionsReadOnly) || diningDisabled}
          />
        </div>
      )}
    </>
  )
}
