import React, { useState, useRef, useEffect } from 'react'
import { Compose } from '../../feed/Compose'
import { Profile } from '../../../types/profile'
import { Modal } from '../../util/modal'

export const PopupCompose = () => {
  return (
    <div className="px-3 py-5 md:px-7 bg-white overflow-clip flex flex-col space-y-0 w-auto md:w-[40rem]">
      <div>
        <Compose hideTopic={false} maxTextboxHeightPx={250} minTextboxHeightPx={200} />
      </div>
    </div>
  )
}

export const PopupComposeFullscreen = ({ open, setOpen }: { open: boolean; setOpen: (b: boolean) => void }) => {
  return (
    <Modal open={open} setOpen={setOpen}>
      <PopupCompose />
    </Modal>
  )
}
